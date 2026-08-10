export type SubmissionStateInput = {
  showcaseStatus: string;
  safetyStatus: string;
  judgeStatus: string;
  rankingStatus: string;
  rank: number | null;
  runStatus: string | null;
  failureCode?: string | null;
  failureSummary?: string | null;
};

export type SubmissionState = {
  code:
    | "processing"
    | "processing_failed"
    | "awaiting_review"
    | "reviewed"
    | "ranked"
    | "blocked";
  label:
    | "Processing"
    | "Processing failed"
    | "Awaiting review"
    | "Reviewed"
    | "Ranked"
    | "Blocked";
  detail: string;
  tone: "approved" | "blocked" | "neutral" | "pending";
  publicVisible: boolean;
  ranked: boolean;
  blockedReason: string | null;
};

export function computeSubmissionState(
  input: SubmissionStateInput,
): SubmissionState {
  if (input.showcaseStatus === "removed") {
    return state(
      "blocked",
      "Blocked",
      "This Test is no longer public.",
      "blocked",
      false,
      false,
      "The Test was removed by moderation.",
    );
  }
  if (input.showcaseStatus === "rejected") {
    return state(
      "blocked",
      "Blocked",
      "This Test was not published.",
      "blocked",
      false,
      false,
      "The Test did not pass publication review.",
    );
  }
  if (input.showcaseStatus === "draft") {
    if (input.safetyStatus === "blocked") {
      return state(
        "blocked",
        "Blocked",
        "This Test is private because its evidence did not pass the safety scan.",
        "blocked",
        false,
        false,
        "At least one uploaded artifact was blocked by the safety scan.",
      );
    }
    if (input.failureCode || input.failureSummary) {
      return state(
        "processing_failed",
        "Processing failed",
        "Evidence processing did not finish. Retry the failed processing step.",
        "blocked",
        false,
        false,
        processingFailureReason(input),
      );
    }
    return state(
      "processing",
      "Processing",
      input.safetyStatus === "approved"
        ? "Evidence is approved and publication is finishing."
        : "Evidence is being checked before this Test becomes public.",
      "pending",
      false,
      false,
      null,
    );
  }

  const publicVisible =
    input.showcaseStatus === "published" && input.safetyStatus === "approved";
  if (!publicVisible) {
    return state(
      "blocked",
      "Blocked",
      "This Test cannot be shown because its publication and safety states disagree.",
      "blocked",
      false,
      false,
      "The Test is not both published and safety-approved.",
    );
  }

  if (input.rank !== null && input.rank > 0) {
    return state(
      "ranked",
      "Ranked",
      `This Test is ranked #${input.rank} in the current leaderboard.`,
      "approved",
      true,
      true,
      null,
    );
  }

  if (
    input.judgeStatus === "scored" ||
    input.judgeStatus === "unranked" ||
    input.runStatus === "scored" ||
    input.runStatus === "published"
  ) {
    return state(
      "reviewed",
      "Reviewed",
      "This Test has a completed review but is not currently ranked.",
      "neutral",
      true,
      false,
      null,
    );
  }

  return state(
    "awaiting_review",
    "Awaiting review",
    "This Test is safe and public. Reviews and ranking can be added later.",
    "pending",
    true,
    false,
    null,
  );
}

function processingFailureReason(input: SubmissionStateInput) {
  if (input.failureSummary?.trim()) return input.failureSummary.trim();
  if (input.failureCode?.trim()) {
    return `Processing stopped with ${humanize(input.failureCode)}.`;
  }
  return "Evidence processing did not complete successfully.";
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

function state(
  code: SubmissionState["code"],
  label: SubmissionState["label"],
  detail: string,
  tone: SubmissionState["tone"],
  publicVisible: boolean,
  ranked: boolean,
  blockedReason: string | null,
): SubmissionState {
  return {
    code,
    label,
    detail,
    tone,
    publicVisible,
    ranked,
    blockedReason,
  };
}
