export type PipelineStage =
  | "generate-platform"
  | "evaluate"
  | "judge"
  | "publish";

export type PipelineMessage = {
  runId: string;
  stage: PipelineStage;
  stageVersion: string;
};
