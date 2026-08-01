import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  disputes,
  evaluationVersions,
  judgeBudgetReservations,
  judgeSamples,
  runs,
  showcases,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  claimJudgeBudget,
  JudgeBudgetConfigurationError,
} from "@/lib/judging/budget";
import { transitionRun } from "@/lib/data/runs";
import { MODERATOR_REJUDGE_STAGE_VERSION } from "@/lib/pipeline/judge-dispatch";
import { missingRejudgeSamples } from "@/lib/pipeline/dispute-rejudge";
import {
  claimRepairDispatchAttempt,
  FROZEN_EVALUATION_REPAIR_FAILURE_CODE,
  FROZEN_EVALUATION_REPAIR_FAILURE_SUMMARY,
  isActiveEvaluationVersion,
  REPAIR_MAX_ATTEMPTS,
  recordRepairDispatch,
} from "@/lib/pipeline/repair-backoff";

export async function requestDisputeRejudgment(input: {
  actorUserId: string | null;
  audit?: boolean | "queued-only";
  disputeId: string;
  repairAttempt?: boolean;
  runId: string;
}) {
  const [run] = await getDb()
    .select({
      contributorId: runs.contributorId,
      credentialMode: runs.credentialMode,
      evaluationVersionId: runs.evaluationVersionId,
      evaluationStatus: evaluationVersions.status,
      showcaseId: runs.showcaseId,
      status: runs.status,
    })
    .from(runs)
    .innerJoin(
      evaluationVersions,
      eq(evaluationVersions.id, runs.evaluationVersionId),
    )
    .where(eq(runs.id, input.runId))
    .limit(1);
  if (
    !run?.showcaseId ||
    run.credentialMode !== "community-submission" ||
    (run.status !== "scored" && run.status !== "published")
  ) {
    return { status: "not-applicable" as const };
  }
  const [sampleRow] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(judgeSamples)
    .where(
      and(
        eq(judgeSamples.runId, input.runId),
        eq(judgeSamples.evaluationVersionId, run.evaluationVersionId),
      ),
  );
  const missingSamples = missingRejudgeSamples(Number(sampleRow?.count ?? 0));
  if (missingSamples === 0) {
    await auditRejudge(input, "run.dispute_rejudge_already_complete", {
      missingSamples,
    });
    return { missingSamples, status: "already-complete" as const };
  }
  if (run.evaluationStatus === "frozen") {
    await markRepairFailure({
      reason: FROZEN_EVALUATION_REPAIR_FAILURE_CODE,
      runId: input.runId,
      showcaseId: run.showcaseId,
    });
    return {
      missingSamples,
      reason: FROZEN_EVALUATION_REPAIR_FAILURE_CODE,
      status: "failed" as const,
    };
  }
  if (!isActiveEvaluationVersion(run.evaluationStatus)) {
    return { status: "not-applicable" as const };
  }
  const { env } = await import("cloudflare:workers");
  const repairAttempt = input.repairAttempt
    ? await claimRepairDispatchAttempt({
        db: env.DB,
        runId: input.runId,
        stageVersion: MODERATOR_REJUDGE_STAGE_VERSION,
      })
    : undefined;
  if (repairAttempt?.action === "skip") {
    if (repairAttempt.reason === "exhausted") {
      await markRepairFailure({
        reason: "repair_attempts_exhausted",
        runId: input.runId,
        showcaseId: run.showcaseId,
      });
    }
    return {
      missingSamples,
      reason: `repair_${repairAttempt.reason}`,
      status: "deferred" as const,
    };
  }

  await getDb()
    .update(showcases)
    .set({ judgeStatus: "judging", updatedAt: new Date() })
    .where(eq(showcases.id, run.showcaseId));

  const [reservedRow] = await getDb()
    .select({ count: sql<number>`coalesce(sum(${judgeBudgetReservations.sampleCount}), 0)` })
    .from(judgeBudgetReservations)
    .where(
      and(
        eq(judgeBudgetReservations.runId, input.runId),
        eq(judgeBudgetReservations.purpose, "moderator-rejudge"),
      ),
    );
  const alreadyReserved = Math.max(0, Number(reservedRow?.count ?? 0));
  let reservation:
    | Awaited<ReturnType<typeof claimJudgeBudget>>
    | undefined;
  if (alreadyReserved < missingSamples) {
    try {
      reservation = await claimJudgeBudget({
        contributorId: run.contributorId,
        purpose: "moderator-rejudge",
        runId: input.runId,
        sampleCount: missingSamples - alreadyReserved,
      });
    } catch (error) {
      if (!(error instanceof JudgeBudgetConfigurationError)) throw error;
    }
  } else {
    reservation = {
      allowed: true,
      dayStartedAt: new Date(0),
      newlyReserved: false,
      reservationId: "existing-moderator-rejudge-reservation",
    };
  }
  if (!reservation?.allowed) {
    const reason = reservation?.reason ?? "budget_not_configured";
    if (repairAttempt?.action === "attempt") {
      await recordRepairDispatch({
        claimId: repairAttempt.claimId,
        db: env.DB,
        errorCode: "judge_budget_denied",
        outcome: "failed",
      });
      if (repairAttempt.attemptCount >= REPAIR_MAX_ATTEMPTS) {
        await markRepairFailure({
          reason: "repair_attempts_exhausted",
          runId: input.runId,
          showcaseId: run.showcaseId,
        });
      }
    }
    await auditRejudge(input, "run.dispute_rejudge_deferred", {
      missingSamples,
      reason,
    });
    return { missingSamples, reason, status: "deferred" as const };
  }

  try {
    await env.JUDGE_QUEUE.send({
      runId: input.runId,
      stage: "judge",
      stageVersion: MODERATOR_REJUDGE_STAGE_VERSION,
    });
  } catch (error) {
    if (repairAttempt?.action === "attempt") {
      await recordRepairDispatch({
        claimId: repairAttempt.claimId,
        db: env.DB,
        errorCode: "queue_unavailable",
        outcome: "failed",
      });
      if (repairAttempt.attemptCount >= REPAIR_MAX_ATTEMPTS) {
        await markRepairFailure({
          reason: "repair_attempts_exhausted",
          runId: input.runId,
          showcaseId: run.showcaseId,
        });
      }
    }
    await auditRejudge(input, "run.dispute_rejudge_deferred", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      missingSamples,
      reason: "queue_unavailable",
    });
    return {
      missingSamples,
      reason: "queue_unavailable" as const,
      status: "deferred" as const,
    };
  }
  if (repairAttempt?.action === "attempt") {
    await recordRepairDispatch({
      claimId: repairAttempt.claimId,
      db: env.DB,
      outcome: "queued",
    });
  }
  await auditRejudge(input, "run.dispute_rejudge_queued", {
    alreadyReserved,
    missingSamples,
    newlyReserved: reservation.newlyReserved,
    stageVersion: MODERATOR_REJUDGE_STAGE_VERSION,
  });
  return { missingSamples, status: "queued" as const };
}

async function auditRejudge(
  input: {
    actorUserId: string | null;
    audit?: boolean | "queued-only";
    disputeId: string;
    runId: string;
  },
  action: string,
  metadata: Record<string, unknown>,
) {
  if (input.audit === false) return;
  if (input.audit === "queued-only" && action !== "run.dispute_rejudge_queued") {
    return;
  }
  await appendAuditEvent({
    actorUserId: input.actorUserId,
    entityType: "run",
    entityId: input.runId,
    action,
    metadata: { ...metadata, disputeId: input.disputeId },
  });
}

export async function repairDeferredDisputeRejudgments(limit = 50) {
  const rows = await getDb()
    .select({
      disputeId: sql<string>`min(${disputes.id})`,
      runId: disputes.runId,
    })
    .from(disputes)
    .innerJoin(runs, eq(runs.id, disputes.runId))
    .innerJoin(
      evaluationVersions,
      eq(evaluationVersions.id, runs.evaluationVersionId),
    )
    .innerJoin(showcases, eq(showcases.id, runs.showcaseId))
    .where(
      and(
        inArray(disputes.status, ["open", "resolved"]),
        eq(runs.credentialMode, "community-submission"),
        inArray(evaluationVersions.status, ["active", "frozen"]),
        inArray(runs.status, ["scored", "published"]),
        inArray(showcases.judgeStatus, ["judging", "overdue"]),
        sql`(
          SELECT count(*)
          FROM judge_samples sample
          WHERE sample.run_id = ${runs.id}
            AND sample.evaluation_version_id = ${runs.evaluationVersionId}
        ) < 3`,
      ),
    )
    .groupBy(disputes.runId)
    .orderBy(disputes.runId)
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));
  for (const row of rows) {
    await requestDisputeRejudgment({
      actorUserId: null,
      audit: "queued-only",
      disputeId: row.disputeId,
      repairAttempt: true,
      runId: row.runId,
    });
  }
  return rows.map((row) => row.runId);
}

async function markRepairFailure(input: {
  reason: string;
  runId: string;
  showcaseId: string;
}) {
  const now = new Date();
  const [run] = await getDb()
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);
  const failureSummary =
    input.reason === FROZEN_EVALUATION_REPAIR_FAILURE_CODE
      ? FROZEN_EVALUATION_REPAIR_FAILURE_SUMMARY
      : "AI review stopped after the bounded repair retry policy was exhausted.";
  if (run?.status === "scored") {
    await transitionRun({
      id: input.runId,
      from: run.status,
      to: "evaluation_failed",
      patch: {
        failureCode: input.reason,
        failureSummary,
        rankEligible: false,
      },
    });
  } else {
    await getDb()
      .update(runs)
      .set({
        failureCode: input.reason,
        failureSummary,
        rankEligible: false,
        updatedAt: now,
      })
      .where(eq(runs.id, input.runId));
  }
  await getDb()
    .update(showcases)
    .set({
      judgeStatus: "failed",
      rankingStatus: "ineligible",
      updatedAt: now,
    })
    .where(
      and(
        eq(showcases.id, input.showcaseId),
        inArray(showcases.judgeStatus, ["judging", "overdue"]),
      ),
    );
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: input.runId,
    action: "run.pipeline_failed",
    metadata: {
      code: input.reason,
      repair: true,
      stage: "judge",
    },
  });
}
