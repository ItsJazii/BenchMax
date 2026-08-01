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
    | "draft"
    | "safety_review"
    | "blocked"
    | "public_pending_review"
    | "public_review_delayed"
    | "public_review_failed"
    | "public_ranked"
    | "public_not_ranked"
    | "rejected"
    | "removed";
  label: string;
  detail: string;
  tone: "approved" | "blocked" | "neutral" | "pending";
  publicVisible: boolean;
  ranked: boolean;
  blockedReason: string | null;
};

const rankingReasons: Record<string, string> = {
  catalog_pending:
    "The declared model, model version, or harness is still waiting for catalog review.",
  insufficient_evidence:
    "The uploaded evidence is public, but it is not sufficient for the AI judge to rank reliably.",
  moderation_hold:
    "A moderation review is open. The result stays public but is excluded from rankings.",
  superseded:
    "A newer eligible submission for the same test and configuration is used in rankings.",
  ineligible:
    "This result does not meet the published ranking eligibility rules.",
  pending:
    "The AI review finished, but the leaderboard snapshot has not included this result yet.",
};

export function computeSubmissionState(
  input: SubmissionStateInput,
): SubmissionState {
  if (input.showcaseStatus === "removed") {
    return state(
      "removed",
      "Removed",
      "This submission is no longer public.",
      "blocked",
      false,
      false,
      "The submission was removed by moderation.",
    );
  }
  if (input.showcaseStatus === "rejected") {
    return state(
      "rejected",
      "Rejected",
      "This submission was not published.",
      "blocked",
      false,
      false,
      "The submission did not pass publication review.",
    );
  }
  if (input.showcaseStatus === "draft") {
    if (input.safetyStatus === "blocked") {
      return state(
        "blocked",
        "Blocked before publication",
        "The evidence did not pass the safety scan.",
        "blocked",
        false,
        false,
        "At least one uploaded artifact was blocked by the safety scan.",
      );
    }
    if (input.safetyStatus === "pending" || input.safetyStatus === "scanning") {
      return state(
        "safety_review",
        "Draft — checking evidence",
        "Uploads must pass the safety scan before this result can be published.",
        "pending",
        false,
        false,
        null,
      );
    }
    return state(
      "draft",
      "Draft — ready to publish",
      "The evidence is approved. Publish when the submission details are ready.",
      "neutral",
      false,
      false,
      null,
    );
  }

  const publicVisible = input.showcaseStatus === "published";
  if (!publicVisible || input.safetyStatus !== "approved") {
    return state(
      "blocked",
      "Publication blocked",
      "This result cannot be shown until its publication and safety gates agree.",
      "blocked",
      false,
      false,
      "The result is not both published and safety-approved.",
    );
  }

  if (input.rank !== null && input.rank > 0) {
    return state(
      "public_ranked",
      `Public — ranked #${input.rank}`,
      "The result is included in the current published leaderboard snapshot.",
      "approved",
      true,
      true,
      null,
    );
  }

  if (input.runStatus === "disqualified") {
    return state(
      "public_not_ranked",
      "Public — not ranked",
      "The evidence remains visible, but this run was disqualified from rankings.",
      "blocked",
      true,
      false,
      "The AI-review run was disqualified from rankings.",
    );
  }

  if (
    input.judgeStatus === "failed" ||
    input.runStatus === "evaluation_failed"
  ) {
    const reason = reviewFailureReason(input);
    return state(
      "public_review_failed",
      "Public — AI review failed",
      "The submitted evidence remains visible. Operations can retry the AI review.",
      "blocked",
      true,
      false,
      reason,
    );
  }

  if (input.judgeStatus === "overdue") {
    return state(
      "public_review_delayed",
      "Public — AI review delayed",
      "The result remains visible while review continues beyond the 24-hour target.",
      "pending",
      true,
      false,
      "The AI review has exceeded the 24-hour target and has not produced a rank yet.",
    );
  }

  if (
    input.judgeStatus === "scored" ||
    input.judgeStatus === "unranked" ||
    input.runStatus === "scored" ||
    input.runStatus === "published"
  ) {
    const reason =
      rankingReasons[input.rankingStatus] ??
      "The result was scored but is not present in the current published leaderboard snapshot.";
    return state(
      "public_not_ranked",
      "Public — scored, not ranked",
      reason,
      input.rankingStatus === "pending" ? "pending" : "neutral",
      true,
      false,
      reason,
    );
  }

  return state(
    "public_pending_review",
    "Public — pending AI review",
    "The result is already visible. AI judging and ranking may take up to 24 hours.",
    "pending",
    true,
    false,
    input.judgeStatus === "not_queued"
      ? "The result is waiting for available AI-review capacity."
      : null,
  );
}

function reviewFailureReason(input: SubmissionStateInput) {
  if (input.failureSummary?.trim()) return input.failureSummary.trim();
  if (input.failureCode?.trim()) {
    return `The AI review stopped with ${humanize(input.failureCode)}.`;
  }
  return "The AI review did not complete successfully.";
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

function state(
  code: SubmissionState["code"],
  label: string,
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
