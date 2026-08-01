export type JudgeDispatchAction = "judge" | "publish" | "skip";

export const TOP_TEN_ESCALATION_STAGE_VERSION =
  "escalation-three-sample-v1";
export const MODERATOR_REJUDGE_STAGE_VERSION =
  "moderator-rejudge-three-sample-v1";

export function isThreeSampleJudgeStage(stageVersion: string) {
  return (
    stageVersion === TOP_TEN_ESCALATION_STAGE_VERSION ||
    stageVersion === MODERATOR_REJUDGE_STAGE_VERSION
  );
}

export function judgeSampleTargetForStage(input: {
  credentialMode: string;
  configuredSampleCount: number;
  stageVersion: string;
}) {
  if (
    input.credentialMode === "community-submission" &&
    isThreeSampleJudgeStage(input.stageVersion)
  ) {
    return 3;
  }
  return input.credentialMode === "community-submission"
    ? 1
    : input.configuredSampleCount;
}

export function selectJudgeDispatchAction(input: {
  stageVersion: string;
  status: string | null;
}): JudgeDispatchAction {
  if (
    isThreeSampleJudgeStage(input.stageVersion) &&
    (input.status === "scored" || input.status === "published")
  ) {
    return "judge";
  }
  if (input.status === "scored") return "publish";
  if (input.status === "published") return "skip";
  return "judge";
}
