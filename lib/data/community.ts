import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  abuseReports,
  benchmarkProposals,
  disputes,
  moderationActions,
  runs,
  showcases,
  users,
} from "@/db/schema";
import type { z } from "zod";
import {
  benchmarkProposalSchema,
  disputeCreateSchema,
  disputeResolutionSchema,
  moderationActionSchema,
  proposalReviewSchema,
} from "@/lib/security/community";
import { canonicalJson } from "@/lib/security/canonical";

export async function createDispute(
  userId: string,
  input: z.infer<typeof disputeCreateSchema>,
) {
  const parsed = disputeCreateSchema.parse(input);
  const [run] = await getDb()
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, parsed.runId), eq(runs.status, "published")))
    .limit(1);
  if (!run) throw new CommunityTargetError();
  const [existing] = await getDb()
    .select({ id: disputes.id })
    .from(disputes)
    .where(
      and(
        eq(disputes.runId, run.id),
        eq(disputes.openedByUserId, userId),
        inArray(disputes.status, ["open", "reviewing"]),
      ),
    )
    .limit(1);
  if (existing) throw new DuplicateDisputeError();
  const now = new Date();
  const [dispute] = await getDb()
    .insert(disputes)
    .values({
      id: crypto.randomUUID(),
      runId: run.id,
      openedByUserId: userId,
      reason: parsed.reason,
      status: "open",
      resolution: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return dispute;
}

export async function listPublicRunDisputes(runId: string) {
  return getDb()
    .select({
      id: disputes.id,
      reason: disputes.reason,
      status: disputes.status,
      resolution: disputes.resolution,
      openedByHandle: users.handle,
      createdAt: disputes.createdAt,
      resolvedAt: disputes.resolvedAt,
    })
    .from(disputes)
    .innerJoin(users, eq(disputes.openedByUserId, users.id))
    .where(eq(disputes.runId, runId))
    .orderBy(desc(disputes.createdAt));
}

export async function resolveDispute(
  actorUserId: string,
  disputeId: string,
  input: z.infer<typeof disputeResolutionSchema>,
) {
  const parsed = disputeResolutionSchema.parse(input);
  const [current] = await getDb()
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);
  if (!current || !["open", "reviewing"].includes(current.status)) {
    throw new CommunityTargetError();
  }
  const now = new Date();
  const [updated] = await getDb()
    .update(disputes)
    .set({
      status: parsed.status,
      resolution: parsed.resolution,
      resolvedByUserId: actorUserId,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(disputes.id, disputeId),
        inArray(disputes.status, ["open", "reviewing"]),
      ),
    )
    .returning();
  if (!updated) throw new CommunityConflictError();
  await getDb().insert(moderationActions).values({
    id: crypto.randomUUID(),
    actorUserId,
    entityType: "dispute",
    entityId: disputeId,
    action: parsed.status === "resolved" ? "resolve" : "dismiss",
    reason: parsed.resolution,
    previousStateJson: canonicalJson({ status: current.status }),
    nextStateJson: canonicalJson({ status: parsed.status }),
    createdAt: now,
  });
  return updated;
}

export async function applyModerationAction(
  actorUserId: string,
  input: z.infer<typeof moderationActionSchema>,
) {
  const parsed = moderationActionSchema.parse(input);
  const now = new Date();
  let previous: Record<string, unknown>;
  let next: Record<string, unknown>;
  if (parsed.entityType === "run") {
    if (parsed.action !== "disqualify") throw new InvalidModerationActionError();
    const [record] = await getDb()
      .select({ status: runs.status, rankEligible: runs.rankEligible })
      .from(runs)
      .where(eq(runs.id, parsed.entityId))
      .limit(1);
    if (!record || !["published", "scored"].includes(record.status)) {
      throw new CommunityTargetError();
    }
    previous = record;
    next = { status: "disqualified", rankEligible: false, playableEnabled: false };
    await getDb()
      .update(runs)
      .set({
        status: "disqualified",
        rankEligible: false,
        playableEnabled: false,
        failureCode: "moderator_disqualified",
        failureSummary: parsed.reason.slice(0, 300),
        updatedAt: now,
      })
      .where(eq(runs.id, parsed.entityId));
  } else if (parsed.entityType === "showcase") {
    const [record] = await getDb()
      .select({
        status: showcases.status,
        safetyStatus: showcases.safetyStatus,
      })
      .from(showcases)
      .where(eq(showcases.id, parsed.entityId))
      .limit(1);
    if (!record) throw new CommunityTargetError();
    previous = record;
    if (parsed.action === "unpublish") {
      next = { status: "removed" };
      await getDb()
        .update(showcases)
        .set({ status: "removed", updatedAt: now })
        .where(eq(showcases.id, parsed.entityId));
    } else if (
      parsed.action === "restore" &&
      record.safetyStatus === "approved"
    ) {
      next = { status: "published" };
      await getDb()
        .update(showcases)
        .set({ status: "published", updatedAt: now })
        .where(eq(showcases.id, parsed.entityId));
    } else {
      throw new InvalidModerationActionError();
    }
  } else {
    if (!["resolve", "dismiss"].includes(parsed.action)) {
      throw new InvalidModerationActionError();
    }
    const [record] = await getDb()
      .select({ status: abuseReports.status })
      .from(abuseReports)
      .where(eq(abuseReports.id, parsed.entityId))
      .limit(1);
    if (!record || !["open", "reviewing"].includes(record.status)) {
      throw new CommunityTargetError();
    }
    previous = record;
    const status = parsed.action === "resolve" ? "resolved" : "dismissed";
    next = { status };
    await getDb()
      .update(abuseReports)
      .set({ status })
      .where(eq(abuseReports.id, parsed.entityId));
  }
  await getDb().insert(moderationActions).values({
    id: crypto.randomUUID(),
    actorUserId,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    action: parsed.action,
    reason: parsed.reason,
    previousStateJson: canonicalJson(previous),
    nextStateJson: canonicalJson(next),
    createdAt: now,
  });
  return { entityId: parsed.entityId, ...next };
}

export async function createBenchmarkProposal(
  userId: string,
  input: z.infer<typeof benchmarkProposalSchema>,
) {
  const parsed = benchmarkProposalSchema.parse(input);
  const now = new Date();
  const [proposal] = await getDb()
    .insert(benchmarkProposals)
    .values({
      id: crypto.randomUUID(),
      proposerUserId: userId,
      title: parsed.title,
      category: parsed.category,
      specificationJson: canonicalJson({
        canonicalPrompt: parsed.canonicalPrompt,
        rationale: parsed.rationale,
        requiredOutputs: parsed.requiredOutputs,
        rubric: parsed.rubric,
      }),
      status: "submitted",
      reviewedByUserId: null,
      reviewReason: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return proposal;
}

export async function reviewBenchmarkProposal(
  actorUserId: string,
  proposalId: string,
  input: z.infer<typeof proposalReviewSchema>,
) {
  const parsed = proposalReviewSchema.parse(input);
  const now = new Date();
  const [proposal] = await getDb()
    .update(benchmarkProposals)
    .set({
      status: parsed.status,
      reviewedByUserId: actorUserId,
      reviewReason: parsed.reason,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(benchmarkProposals.id, proposalId),
        eq(benchmarkProposals.status, "submitted"),
      ),
    )
    .returning();
  if (!proposal) throw new CommunityConflictError();
  return proposal;
}

export async function listModerationQueue() {
  const [reports, openDisputes, proposals] = await Promise.all([
    getDb()
      .select()
      .from(abuseReports)
      .where(inArray(abuseReports.status, ["open", "reviewing"]))
      .orderBy(abuseReports.createdAt)
      .limit(100),
    getDb()
      .select()
      .from(disputes)
      .where(inArray(disputes.status, ["open", "reviewing"]))
      .orderBy(disputes.createdAt)
      .limit(100),
    getDb()
      .select()
      .from(benchmarkProposals)
      .where(eq(benchmarkProposals.status, "submitted"))
      .orderBy(benchmarkProposals.createdAt)
      .limit(100),
  ]);
  return { reports, disputes: openDisputes, proposals };
}

export class CommunityTargetError extends Error {
  readonly status = 404;
  constructor() {
    super("The requested community record was not found.");
    this.name = "CommunityTargetError";
  }
}

export class DuplicateDisputeError extends Error {
  readonly status = 409;
  constructor() {
    super("You already have an open dispute for this run.");
    this.name = "DuplicateDisputeError";
  }
}

export class CommunityConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("The community record changed before this operation completed.");
    this.name = "CommunityConflictError";
  }
}

export class InvalidModerationActionError extends Error {
  readonly status = 400;
  constructor() {
    super("That moderation action is not valid for this record.");
    this.name = "InvalidModerationActionError";
  }
}
