import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  creditLedger,
  generationRecords,
  judgeSamples,
  runs,
} from "@/db/schema";
import { and } from "drizzle-orm";

export async function getCreditBalance(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({
      balance: sql<number>`coalesce(sum(${creditLedger.amountMilliCredits}), 0)`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return Number(row?.balance ?? 0);
}

export async function reserveRunCredits(input: {
  runId: string;
  userId: string;
  amountMilliCredits: number;
}) {
  if (
    !Number.isSafeInteger(input.amountMilliCredits) ||
    input.amountMilliCredits <= 0
  ) {
    throw new TypeError("Credit reservation must be a positive integer.");
  }
  const result = await env.DB.prepare(
    `INSERT INTO credit_ledger
      (id, user_id, run_id, type, amount_milli_credits, idempotency_key, metadata_json, actor_user_id, created_at)
     SELECT ?, ?, ?, 'reserve', ?, ?, '{}', NULL, ?
     WHERE (
       SELECT coalesce(sum(amount_milli_credits), 0)
       FROM credit_ledger
       WHERE user_id = ?
     ) >= ?`,
  )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.runId,
      -input.amountMilliCredits,
      `run:${input.runId}:reserve`,
      Date.now(),
      input.userId,
      input.amountMilliCredits,
    )
    .run();
  if (result.meta.changes !== 1) throw new InsufficientCreditsError();
}

export async function grantCredits(input: {
  actorUserId: string;
  amountMilliCredits: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  userId: string;
}) {
  if (
    !Number.isSafeInteger(input.amountMilliCredits) ||
    input.amountMilliCredits <= 0 ||
    input.amountMilliCredits > 10_000_000
  ) {
    throw new InvalidCreditGrantError();
  }
  await getDb()
    .insert(creditLedger)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      runId: null,
      type: "admin-grant",
      amountMilliCredits: input.amountMilliCredits,
      idempotencyKey: input.idempotencyKey,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      actorUserId: input.actorUserId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function refundRunCredits(input: {
  amountMilliCredits: number;
  reason: string;
  runId: string;
  userId: string;
}) {
  if (
    !Number.isSafeInteger(input.amountMilliCredits) ||
    input.amountMilliCredits <= 0
  ) {
    throw new TypeError("Credit refund must be a positive integer.");
  }
  await getDb()
    .insert(creditLedger)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      runId: input.runId,
      type: "refund",
      amountMilliCredits: input.amountMilliCredits,
      idempotencyKey: `run:${input.runId}:launch-refund`,
      metadataJson: JSON.stringify({ reason: input.reason.slice(0, 120) }),
      actorUserId: null,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function settlePlatformRunCredits(input: {
  runId: string;
  userId: string;
}) {
  const [run] = await getDb()
    .select({ credentialMode: runs.credentialMode })
    .from(runs)
    .where(
      and(
        eq(runs.id, input.runId),
        eq(runs.contributorId, input.userId),
      ),
    )
    .limit(1);
  if (!run || run.credentialMode !== "platform-credit") return;
  const [[generation], [judge]] = await Promise.all([
    getDb()
      .select({
        inputTokens: generationRecords.inputTokens,
        outputTokens: generationRecords.outputTokens,
      })
      .from(generationRecords)
      .where(eq(generationRecords.runId, input.runId))
      .limit(1),
    getDb()
      .select({
        inputTokens: sql<number>`coalesce(sum(${judgeSamples.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${judgeSamples.outputTokens}), 0)`,
      })
      .from(judgeSamples)
      .where(eq(judgeSamples.runId, input.runId)),
  ]);
  const generationCost = Math.min(
    60_000,
    10_000 +
      Number(generation?.inputTokens ?? 0) +
      Number(generation?.outputTokens ?? 0) * 2,
  );
  const sandboxCost = generation ? 20_000 : 0;
  const judgeCost = judge
    ? Math.min(
        20_000,
        5_000 +
          Number(judge.inputTokens ?? 0) +
          Number(judge.outputTokens ?? 0) * 2,
      )
    : 0;
  const now = new Date();
  await getDb()
    .insert(creditLedger)
    .values([
      {
        id: crypto.randomUUID(),
        userId: input.userId,
        runId: input.runId,
        type: "refund",
        amountMilliCredits: 100_000,
        idempotencyKey: `run:${input.runId}:settlement-release`,
        metadataJson: JSON.stringify({ reservationMilliCredits: 100_000 }),
        actorUserId: null,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId: input.userId,
        runId: input.runId,
        type: "generation-charge",
        amountMilliCredits: -Math.max(1, generationCost),
        idempotencyKey: `run:${input.runId}:generation-charge`,
        metadataJson: JSON.stringify({
          inputTokens: generation?.inputTokens ?? null,
          outputTokens: generation?.outputTokens ?? null,
        }),
        actorUserId: null,
        createdAt: now,
      },
      ...(sandboxCost > 0
        ? [
            {
              id: crypto.randomUUID(),
              userId: input.userId,
              runId: input.runId,
              type: "sandbox-charge" as const,
              amountMilliCredits: -sandboxCost,
              idempotencyKey: `run:${input.runId}:sandbox-charge`,
              metadataJson: JSON.stringify({
                environment: "browser-web-v1",
              }),
              actorUserId: null,
              createdAt: now,
            },
          ]
        : []),
      ...(judgeCost > 0
        ? [
            {
              id: crypto.randomUUID(),
              userId: input.userId,
              runId: input.runId,
              type: "judge-charge" as const,
              amountMilliCredits: -judgeCost,
              idempotencyKey: `run:${input.runId}:judge-charge`,
              metadataJson: JSON.stringify({
                inputTokens: Number(judge?.inputTokens ?? 0),
                outputTokens: Number(judge?.outputTokens ?? 0),
              }),
              actorUserId: null,
              createdAt: now,
            },
          ]
        : []),
    ])
    .onConflictDoNothing();
}

export class InsufficientCreditsError extends Error {
  readonly status = 402;

  constructor() {
    super("This account does not have enough admin-granted platform credits.");
    this.name = "InsufficientCreditsError";
  }
}

export class InvalidCreditGrantError extends Error {
  readonly status = 400;

  constructor() {
    super("Credit grant is outside the allowed range.");
    this.name = "InvalidCreditGrantError";
  }
}
