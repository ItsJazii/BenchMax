import type { PipelineMessage, PipelineStage } from "./messages";
import type { RunStatus } from "@/lib/security/run-policy";
import type { StageClaimResult } from "./stage-claim-service";

const STALLED_RUN_MS = 10 * 60 * 1000;
const RECOVERY_BATCH_SIZE = 100;

type QueueLike = {
  send(message: PipelineMessage): Promise<unknown>;
};

export type PipelineQueues = {
  evaluate: QueueLike;
  generatePlatform: QueueLike;
  judge: QueueLike;
};

export type ManualRetryPlan = {
  queue: "evaluate" | "judge";
  stage: "evaluate" | "judge" | "publish";
  targetStatus: "queued_evaluation" | "judging" | "scored";
};

export function manualRetryPlan(
  failedStage: PipelineStage | null,
  options: { alreadyScored?: boolean } = {},
): ManualRetryPlan {
  if (options.alreadyScored) {
    return { queue: "judge", stage: "publish", targetStatus: "scored" };
  }
  if (failedStage === "judge") {
    return { queue: "judge", stage: "judge", targetStatus: "judging" };
  }
  if (failedStage === "publish") {
    return { queue: "judge", stage: "publish", targetStatus: "scored" };
  }
  return {
    queue: "evaluate",
    stage: "evaluate",
    targetStatus: "queued_evaluation",
  };
}

export function leaseRetryDelaySeconds(leaseExpiresAt: number, now = Date.now()) {
  const remainingSeconds = Math.ceil((leaseExpiresAt - now) / 1000);
  return Math.min(300, Math.max(5, remainingSeconds));
}

export function stageClaimDisposition(
  claim: StageClaimResult,
  now = Date.now(),
):
  | { action: "ack" }
  | { action: "execute"; claimId: string }
  | { action: "retry"; delaySeconds: number } {
  if (claim.status === "completed") return { action: "ack" };
  if (claim.status === "busy") {
    return {
      action: "retry",
      delaySeconds: leaseRetryDelaySeconds(claim.leaseExpiresAt, now),
    };
  }
  return { action: "execute", claimId: claim.id };
}

export function recoveryStageForRun(input: {
  completedEvaluate?: boolean;
  completedPublish?: boolean;
  status: RunStatus;
}): PipelineStage | null {
  if (
    input.status === "queued_generation" ||
    input.status === "generating"
  ) {
    return "generate-platform";
  }
  if (input.status === "generated") return "evaluate";
  if (
    input.status === "queued_evaluation" ||
    input.status === "evaluating"
  ) {
    return input.completedEvaluate ? "judge" : "evaluate";
  }
  if (input.status === "judging") return "judge";
  if (input.status === "scored" && !input.completedPublish) return "publish";
  return null;
}

export async function findLatestFailedPipelineStage(
  db: D1Database,
  runId: string,
): Promise<PipelineStage | null> {
  const row = await db
    .prepare(
      `SELECT stage
       FROM run_stage_claims
       WHERE run_id = ? AND status <> 'completed'
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(runId)
    .first<{ stage: PipelineStage }>();
  return row?.stage ?? null;
}

export async function recoverStalledPipelineRuns(input: {
  auditTransition?(transition: {
    from: RunStatus;
    runId: string;
    stage: PipelineStage;
    to: RunStatus;
  }): Promise<void>;
  db: D1Database;
  now?: number;
  queues: PipelineQueues;
}): Promise<PipelineMessage[]> {
  const now = input.now ?? Date.now();
  const candidates = await input.db
    .prepare(
      `SELECT
         r.id AS run_id,
         r.status,
         EXISTS(
           SELECT 1 FROM run_stage_claims c
           WHERE c.run_id = r.id
             AND c.stage = 'evaluate'
             AND c.stage_version = '1'
             AND c.status = 'completed'
         ) AS completed_evaluate,
         EXISTS(
           SELECT 1 FROM run_stage_claims c
           WHERE c.run_id = r.id
             AND c.stage = 'publish'
             AND c.stage_version = '1'
             AND c.status = 'completed'
         ) AS completed_publish
       FROM runs r
       WHERE r.status IN (
         'queued_generation',
         'generating',
         'generated',
         'queued_evaluation',
         'evaluating',
         'judging',
         'scored'
       )
       AND (
         r.updated_at < ?
         OR EXISTS(
           SELECT 1 FROM run_stage_claims c
           WHERE c.run_id = r.id
             AND c.status = 'claimed'
             AND c.lease_expires_at < ?
         )
       )
       ORDER BY r.updated_at ASC
       LIMIT ?`,
    )
    .bind(now - STALLED_RUN_MS, now, RECOVERY_BATCH_SIZE)
    .all<{
      completed_evaluate: number;
      completed_publish: number;
      run_id: string;
      status: RunStatus;
    }>();

  const recovered: PipelineMessage[] = [];
  for (const candidate of candidates.results) {
    let statusTransition:
      | { from: RunStatus; to: RunStatus }
      | undefined;
    const stage = recoveryStageForRun({
      completedEvaluate: Boolean(candidate.completed_evaluate),
      completedPublish: Boolean(candidate.completed_publish),
      status: candidate.status,
    });
    if (!stage) continue;

    if (candidate.status === "generated") {
      const transitioned = await input.db
        .prepare(
          `UPDATE runs
           SET status = 'queued_evaluation', updated_at = ?
           WHERE id = ? AND status = 'generated'`,
        )
        .bind(now, candidate.run_id)
        .run();
      if (transitioned.meta.changes !== 1) continue;
      statusTransition = {
        from: "generated",
        to: "queued_evaluation",
      };
    } else if (
      candidate.status === "queued_evaluation" &&
      stage === "judge"
    ) {
      const transitioned = await input.db
        .prepare(
          `UPDATE runs
           SET status = 'evaluating', updated_at = ?
           WHERE id = ? AND status = 'queued_evaluation'`,
        )
        .bind(now, candidate.run_id)
        .run();
      if (transitioned.meta.changes !== 1) continue;
      statusTransition = {
        from: "queued_evaluation",
        to: "evaluating",
      };
    }

    const message: PipelineMessage = {
      runId: candidate.run_id,
      stage,
      stageVersion: "1",
    };
    try {
      await queueForStage(input.queues, stage).send(message);
    } catch (error) {
      if (
        candidate.status === "generated" ||
        candidate.status === "queued_evaluation"
      ) {
        await input.db
          .prepare(
            `UPDATE runs
             SET updated_at = ?
             WHERE id = ?`,
          )
          .bind(now - STALLED_RUN_MS - 1, candidate.run_id)
          .run();
      }
      throw error;
    }
    await input.db
      .prepare(
        `UPDATE runs
         SET updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, candidate.run_id)
      .run();
    if (statusTransition && input.auditTransition) {
      await input.auditTransition({
        ...statusTransition,
        runId: candidate.run_id,
        stage,
      });
    }
    recovered.push(message);
  }
  return recovered;
}

function queueForStage(queues: PipelineQueues, stage: PipelineStage) {
  if (stage === "generate-platform") return queues.generatePlatform;
  if (stage === "evaluate") return queues.evaluate;
  return queues.judge;
}
