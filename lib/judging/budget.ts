import { canonicalSha256 } from "@/lib/security/canonical";

export const DAILY_JUDGED_SUBMISSION_LIMIT = 5;

export type JudgeBudgetPurpose =
  | "initial"
  | "top-ten-escalation"
  | "moderator-rejudge";

export type JudgeBudgetClaim =
  | {
      allowed: true;
      dayStartedAt: Date;
      newlyReserved: boolean;
      reservationId: string;
    }
  | {
      allowed: false;
      dayStartedAt: Date;
      reason: "account_daily_limit" | "global_daily_budget";
    };

export function utcDayStartedAt(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function configuredDailyJudgeSampleBudget(
  value = process.env.BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET,
) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new JudgeBudgetConfigurationError();
  }
  return parsed;
}

export async function claimJudgeBudget(input: {
  contributorId: string;
  now?: Date;
  purpose: JudgeBudgetPurpose;
  runId: string;
  sampleCount: number;
}): Promise<JudgeBudgetClaim> {
  const { env } = await import("cloudflare:workers");
  if (
    !Number.isSafeInteger(input.sampleCount) ||
    input.sampleCount < 1 ||
    input.sampleCount > 3
  ) {
    throw new RangeError("Judge sample reservation must be between 1 and 3.");
  }
  const dailyBudget = configuredDailyJudgeSampleBudget();
  const dayStartedAt = utcDayStartedAt(input.now);
  const dayStartedAtMs = dayStartedAt.getTime();
  const reservationId = await canonicalSha256({
    dayStartedAt: dayStartedAtMs,
    purpose: input.purpose,
    runId: input.runId,
    type: "judge-budget-reservation-v1",
  });
  const existing = await env.DB.prepare(
    `SELECT id FROM judge_budget_reservations WHERE id = ?`,
  )
    .bind(reservationId)
    .first<{ id: string }>();
  if (existing) {
    return {
      allowed: true,
      dayStartedAt,
      newlyReserved: false,
      reservationId,
    };
  }

  const accountClause =
    input.purpose === "initial"
      ? `AND (
          SELECT count(*)
          FROM judge_budget_reservations
          WHERE contributor_id = ?
            AND day_started_at = ?
            AND purpose = 'initial'
        ) < ?`
      : "";
  const bindings: Array<number | string> = [
    reservationId,
    input.runId,
    input.contributorId,
    dayStartedAtMs,
    input.purpose,
    input.sampleCount,
    Date.now(),
    dayStartedAtMs,
    input.sampleCount,
    dailyBudget,
  ];
  if (input.purpose === "initial") {
    bindings.push(
      input.contributorId,
      dayStartedAtMs,
      DAILY_JUDGED_SUBMISSION_LIMIT,
    );
  }
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO judge_budget_reservations
       (id, run_id, contributor_id, day_started_at, purpose, sample_count, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE (
       SELECT coalesce(sum(sample_count), 0)
       FROM judge_budget_reservations
       WHERE day_started_at = ?
     ) + ? <= ?
     ${accountClause}`,
  )
    .bind(...bindings)
    .run();
  if (Number(inserted.meta.changes ?? 0) === 1) {
    return {
      allowed: true,
      dayStartedAt,
      newlyReserved: true,
      reservationId,
    };
  }
  const concurrent = await env.DB.prepare(
    `SELECT id FROM judge_budget_reservations WHERE id = ?`,
  )
    .bind(reservationId)
    .first<{ id: string }>();
  if (concurrent) {
    return {
      allowed: true,
      dayStartedAt,
      newlyReserved: false,
      reservationId,
    };
  }

  if (input.purpose === "initial") {
    const account = await env.DB.prepare(
      `SELECT count(*) AS count
       FROM judge_budget_reservations
       WHERE contributor_id = ?
         AND day_started_at = ?
         AND purpose = 'initial'`,
    )
      .bind(input.contributorId, dayStartedAtMs)
      .first<{ count: number }>();
    if (
      Number(account?.count ?? 0) >= DAILY_JUDGED_SUBMISSION_LIMIT
    ) {
      return { allowed: false, dayStartedAt, reason: "account_daily_limit" };
    }
  }
  return { allowed: false, dayStartedAt, reason: "global_daily_budget" };
}

export class JudgeBudgetConfigurationError extends Error {
  readonly status = 503;

  constructor() {
    super(
      "The daily AI judge budget is not configured. This result remains public and pending review.",
    );
    this.name = "JudgeBudgetConfigurationError";
  }
}
