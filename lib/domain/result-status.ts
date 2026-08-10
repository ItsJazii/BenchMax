export function publicResultStatus(input: {
  judgeStatus: string;
  rank: number | null;
  rankingStatus: string;
}) {
  void input.rankingStatus;
  if (input.rank) return "Ranked";
  if (input.judgeStatus === "scored" || input.judgeStatus === "unranked") {
    return "Reviewed";
  }
  return "Awaiting review";
}
