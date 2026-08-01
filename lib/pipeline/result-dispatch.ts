export type ResultDispatchAction =
  | "evaluate"
  | "move-to-judge"
  | "judge"
  | "none";

export const REPAIRABLE_COMMUNITY_RUN_STATUSES = [
  "queued_evaluation",
  "evaluating",
  "judging",
] as const;

const COMMUNITY_JUDGE_DEADLINE_MS = 24 * 60 * 60 * 1000;

export function selectResultDispatchAction(input: {
  requiresEvaluation: boolean;
  status: string;
}): ResultDispatchAction {
  if (input.status === "judging") return "judge";
  if (
    input.status === "queued_evaluation" ||
    input.status === "evaluating"
  ) {
    return input.requiresEvaluation ? "evaluate" : "move-to-judge";
  }
  return "none";
}

export function initialCommunityRunStatus(requiresEvaluation: boolean) {
  return requiresEvaluation ? ("queued_evaluation" as const) : ("judging" as const);
}

export function formatDeterministicRunId(sha256: string) {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new TypeError("A lowercase SHA-256 digest is required.");
  }
  return [
    sha256.slice(0, 8),
    sha256.slice(8, 12),
    sha256.slice(12, 16),
    sha256.slice(16, 20),
    sha256.slice(20, 32),
  ].join("-");
}

export function communityJudgeDeadline(
  publishedAt: Date | null | undefined,
  now = new Date(),
) {
  const publishedAtMs = publishedAt?.getTime();
  const anchor =
    typeof publishedAtMs === "number" && Number.isFinite(publishedAtMs)
      ? publishedAtMs
      : now.getTime();
  return new Date(anchor + COMMUNITY_JUDGE_DEADLINE_MS);
}
