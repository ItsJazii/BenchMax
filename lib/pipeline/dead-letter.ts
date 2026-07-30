import type { PipelineMessage } from "./messages";
import type { RunStatus } from "@/lib/security/run-policy";

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
