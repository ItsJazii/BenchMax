export type RankingScope =
  | "frontend"
  | "browser-game"
  | "browser-3d"
  | "overall";

export type BenchmarkAggregateInput = {
  benchmark_id: string;
  category: Exclude<RankingScope, "overall">;
  configuration_id: string;
  median_score_bps: number;
  run_count: number;
  snapshot_id: string;
};

export type VersionedBenchmarkAggregateInput = BenchmarkAggregateInput & {
  benchmark_version: number;
};

export function selectDesignatedBenchmarkVersions(
  rows: readonly VersionedBenchmarkAggregateInput[],
): BenchmarkAggregateInput[] {
  const latestVersionByBenchmark = new Map<string, number>();
  for (const row of rows) {
    const current = latestVersionByBenchmark.get(row.benchmark_id);
    if (current === undefined || row.benchmark_version > current) {
      latestVersionByBenchmark.set(row.benchmark_id, row.benchmark_version);
    }
  }
  return rows
    .filter(
      (row) =>
        row.benchmark_version === latestVersionByBenchmark.get(row.benchmark_id),
    )
    .map(({ benchmark_version: benchmarkVersion, ...row }) => {
      void benchmarkVersion;
      return row;
    });
}

export function buildAggregateEntries(
  rows: readonly BenchmarkAggregateInput[],
  scope: RankingScope,
) {
  const configurationIds = [...new Set(rows.map((row) => row.configuration_id))];
  return configurationIds
    .map((configurationId) => {
      const configRows = rows.filter(
        (row) =>
          row.configuration_id === configurationId &&
          (scope === "overall" || row.category === scope),
      );
      if (configRows.length === 0) return null;
      const byCategory = Map.groupBy(configRows, (row) => row.category);
      const categoryScores = [...byCategory.entries()].map(
        ([category, categoryRows]) => ({
          category,
          score: Math.round(
            categoryRows.reduce(
              (sum, row) => sum + row.median_score_bps,
              0,
            ) / categoryRows.length,
          ),
          qualifiedBenchmarkCount: categoryRows.filter(
            (row) => row.run_count >= 3,
          ).length,
        }),
      );
      const scoreBps =
        scope === "overall"
          ? Math.round(
              categoryScores.reduce((sum, item) => sum + item.score, 0) /
                categoryScores.length,
            )
          : categoryScores[0].score;
      const benchmarkCoverage = new Set(
        configRows.map((row) => row.benchmark_id),
      ).size;
      const categoryCoverage = categoryScores.length;
      const qualifiedBenchmarks = categoryScores.reduce(
        (sum, item) => sum + item.qualifiedBenchmarkCount,
        0,
      );
      const provisional =
        scope === "overall"
          ? qualifiedBenchmarks < 5 || categoryCoverage < 3
          : qualifiedBenchmarks < 3;
      return {
        configurationId,
        scoreBps,
        benchmarkCoverage,
        categoryCoverage,
        totalRunCount: configRows.reduce(
          (sum, row) => sum + row.run_count,
          0,
        ),
        provisional,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort(
      (a, b) =>
        b.scoreBps - a.scoreBps ||
        b.benchmarkCoverage - a.benchmarkCoverage ||
        a.configurationId.localeCompare(b.configurationId),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
