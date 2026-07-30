export function rankResultRows(
  rows: Array<{
    runId: string;
    sampleCount: number;
    scoreBps: number | null;
    showcaseId: string;
  }>,
) {
  const ranked: Array<{
    rank: number;
    runId: string;
    sampleCount: number;
    scoreBps: number;
    showcaseId: string;
  }> = [];
  for (const row of rows) {
    const scoreBps = row.scoreBps;
    if (scoreBps === null) continue;
    const previous = ranked.at(-1);
    ranked.push({
      ...row,
      scoreBps,
      rank:
        previous?.scoreBps === scoreBps
          ? previous.rank
          : ranked.length + 1,
      sampleCount: Number(row.sampleCount) >= 3 ? 3 : 1,
    });
  }
  return ranked;
}
