export type PipelineStage =
  | "evaluate"
  | "judge"
  | "publish";

export type PipelineMessage = {
  runId: string;
  stage: PipelineStage;
  stageVersion: string;
};

export const MAX_PIPELINE_STAGE_VERSION_LENGTH = 128;

export function isPipelineStageVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PIPELINE_STAGE_VERSION_LENGTH &&
    /^[a-z0-9._-]+$/i.test(value)
  );
}
