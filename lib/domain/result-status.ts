export function publicResultStatus(input: {
  judgeStatus: string;
  rank: number | null;
  rankingStatus: string;
}) {
  if (input.rank) {
    return `Scored — ranked #${input.rank}`;
  }
  if (
    input.judgeStatus === "queued" ||
    input.judgeStatus === "evaluating" ||
    input.judgeStatus === "judging"
  ) {
    return "Public — pending AI review";
  }
  if (input.judgeStatus === "overdue") return "Delayed";
  if (input.judgeStatus === "failed") {
    return "Scored — not ranked (AI review failed)";
  }
  if (input.judgeStatus === "scored" || input.judgeStatus === "unranked") {
    return `Scored — not ranked (${input.rankingStatus.replace(/_/g, " ")})`;
  }
  return "Public — pending AI review";
}
