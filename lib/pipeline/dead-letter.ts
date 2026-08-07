import type { PipelineMessage } from "./messages";
import type { RunStatus } from "@/lib/security/run-policy";

// Environment-agnostic: the same Worker script consumes
// "benchmax-pipeline-dlq" in production and
// "benchmax-staging-pipeline-dlq" in staging.
export function isPipelineDeadLetterQueue(queueName: string): boolean {
  return queueName.endsWith("pipeline-dlq");
}

export const PIPELINE_DLQ_AUDIT_INTERVAL_MS = 12 * 60 * 60 * 1000;

export type PipelineDlqAuditState = {
  backlogCount: number;
  createdAt: number;
};

export function planPipelineDlqAudit(input: {
  metrics: {
    backlogBytes: number;
    backlogCount: number;
    oldestMessageTimestamp?: Date;
  };
  now: number;
  previous: PipelineDlqAuditState | null;
}) {
  const { metrics, now, previous } = input;
  if (metrics.backlogCount > 0) {
    const grew =
      previous === null ||
      previous.backlogCount === 0 ||
      metrics.backlogCount > previous.backlogCount;
    const reminderDue =
      previous !== null &&
      previous.backlogCount > 0 &&
      now - previous.createdAt >= PIPELINE_DLQ_AUDIT_INTERVAL_MS;
    if (!grew && !reminderDue) return null;
    return {
      action: "operations.pipeline_dlq_nonempty" as const,
      metadata: {
        backlogBytes: metrics.backlogBytes,
        backlogCount: metrics.backlogCount,
        oldestMessageTimestamp:
          metrics.oldestMessageTimestamp?.toISOString() ?? null,
        observedAt: new Date(now).toISOString(),
        reason: pipelineDlqNonemptyReason(metrics.backlogCount, previous),
      },
    };
  }
  if (previous === null || previous.backlogCount === 0) return null;
  return {
    action: "operations.pipeline_dlq_cleared" as const,
    metadata: {
      backlogBytes: metrics.backlogBytes,
      backlogCount: 0,
      oldestMessageTimestamp: null,
      observedAt: new Date(now).toISOString(),
      reason: "cleared",
    },
  };
}

function pipelineDlqNonemptyReason(
  backlogCount: number,
  previous: PipelineDlqAuditState | null,
) {
  if (previous === null || previous.backlogCount === 0) return "opened";
  if (backlogCount > previous.backlogCount) return "grew";
  return "reminder";
}

export function isActivePipelineStageStatus(
  stage: PipelineMessage["stage"],
  status: RunStatus | null,
) {
  if (stage === "evaluate") {
    return status === "queued_evaluation" || status === "evaluating";
  }
  if (stage === "judge") {
    return status === "evaluating" || status === "judging";
  }
  return status === "scored";
}

export async function processPipelineDeadLetter(
  message: PipelineMessage,
  dependencies: {
    audit(input: {
      action: string;
      entityId: string;
      metadata: Record<string, unknown>;
    }): Promise<void>;
    markFailed(input: {
      code: string;
      runId: string;
      stage: PipelineMessage["stage"];
    }): Promise<void>;
    getRunStatus(runId: string): Promise<RunStatus | null>;
  },
) {
  const status = await dependencies.getRunStatus(message.runId);
  if (!isActivePipelineStageStatus(message.stage, status)) {
    await dependencies.audit({
      action: "run.pipeline_dead_letter_ignored",
      entityId: message.runId,
      metadata: {
        currentStatus: status,
        stage: message.stage,
        stageVersion: message.stageVersion,
      },
    });
    return;
  }
  await dependencies.markFailed({
    code: "pipeline_dead_lettered",
    runId: message.runId,
    stage: message.stage,
  });
  await dependencies.audit({
    action: "run.pipeline_dead_lettered",
    entityId: message.runId,
    metadata: {
      stage: message.stage,
      stageVersion: message.stageVersion,
    },
  });
}
