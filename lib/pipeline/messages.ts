export type PipelineStage =
  | "evaluate"
  | "judge"
  | "publish";

export type PipelineMessage = {
  runId: string;
  stage: PipelineStage;
  stageVersion: string;
};
