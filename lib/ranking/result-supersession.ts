export type SupersessionCandidate = {
  createdAt: Date;
  id: string;
  publishedAt: Date | null;
  rankingStatus: "eligible" | "superseded";
  supersededById: string | null;
};

export type SupersessionUpdate = {
  id: string;
  rankingStatus: "eligible" | "superseded";
  supersededById: string | null;
};

function recency(candidate: SupersessionCandidate) {
  return (candidate.publishedAt ?? candidate.createdAt).getTime();
}

export function planLatestResultSupersession(
  candidates: SupersessionCandidate[],
) {
  const ordered = [...candidates].sort(
    (left, right) =>
      recency(right) - recency(left) || right.id.localeCompare(left.id),
  );
  const winner = ordered[0] ?? null;
  if (!winner) {
    return {
      updates: [] as SupersessionUpdate[],
      winnerId: null,
    };
  }
  const updates: SupersessionUpdate[] = ordered.flatMap((candidate, index) => {
    const rankingStatus: SupersessionUpdate["rankingStatus"] =
      index === 0 ? "eligible" : "superseded";
    const supersededById = index === 0 ? null : winner.id;
    if (
      candidate.rankingStatus === rankingStatus &&
      candidate.supersededById === supersededById
    ) {
      return [];
    }
    return [{ id: candidate.id, rankingStatus, supersededById }];
  });
  return { updates, winnerId: winner.id };
}
