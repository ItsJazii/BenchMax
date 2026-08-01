export type RankedSampleCount = {
  rank: number;
  sampleCount: number;
};

export function hasPendingTopTenEscalations(
  rows: readonly RankedSampleCount[],
) {
  return rows.some((row) => row.rank <= 10 && row.sampleCount < 3);
}
