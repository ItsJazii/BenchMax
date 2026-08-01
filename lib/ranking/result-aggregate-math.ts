import { summarizeScores } from "./statistics";

export type ResultAggregateInput = {
  contributorId: string;
  declaredSettings: unknown;
  harnessLabel: string;
  metadataHash: string;
  modelLabel: string;
  modelSlug: string;
  modelVersionLabel: string;
  resultConfigurationId: string;
  reasoning: string;
  scoreBps: number;
  snapshotId: string;
  snapshotPublishedAt: Date | null;
  testVersionId: string;
};

export type ResultConfigurationSummary = {
  configurationId: string;
  contributorCount: number;
  declaredSettings: unknown;
  harnessLabel: string;
  metadataHash: string;
  modelLabel: string;
  modelSlug: string;
  modelVersionLabel: string;
  provisional: boolean;
  q1ScoreBps: number;
  q3ScoreBps: number;
  reasoning: string;
  scoreBps: number;
  snapshotDate: Date | null;
  sourceSnapshotIds: string[];
  testCoverage: number;
};

/**
 * Produces community-declared configuration summaries from immutable per-test
 * snapshots. Each test contributes exactly one median, so a popular test cannot
 * outweigh a less popular one.
 */
export function buildResultConfigurationSummaries(
  rows: readonly ResultAggregateInput[],
): ResultConfigurationSummary[] {
  const byConfiguration = Map.groupBy(
    rows,
    (row) => row.resultConfigurationId,
  );
  return [...byConfiguration.entries()]
    .map(([configurationId, configurationRows]) => {
      const first = configurationRows[0];
      const byTest = Map.groupBy(
        configurationRows,
        (row) => row.testVersionId,
      );
      const testMedians = [...byTest.values()].map(
        (testRows) =>
          summarizeScores(testRows.map((row) => row.scoreBps)).median,
      );
      const distribution = summarizeScores(testMedians);
      const contributorCount = new Set(
        configurationRows.map((row) => row.contributorId),
      ).size;
      const snapshotDates = configurationRows
        .map((row) => row.snapshotPublishedAt?.getTime())
        .filter((value): value is number => value !== undefined);
      return {
        configurationId,
        contributorCount,
        declaredSettings: first.declaredSettings,
        harnessLabel: first.harnessLabel,
        metadataHash: first.metadataHash,
        modelLabel: first.modelLabel,
        modelSlug: first.modelSlug,
        modelVersionLabel: first.modelVersionLabel,
        provisional: contributorCount < 3 || testMedians.length < 3,
        q1ScoreBps: distribution.q1,
        q3ScoreBps: distribution.q3,
        reasoning: first.reasoning,
        scoreBps: Math.round(
          testMedians.reduce((sum, score) => sum + score, 0) /
            testMedians.length,
        ),
        snapshotDate:
          snapshotDates.length > 0
            ? new Date(Math.max(...snapshotDates))
            : null,
        sourceSnapshotIds: [
          ...new Set(configurationRows.map((row) => row.snapshotId)),
        ].sort(),
        testCoverage: testMedians.length,
      };
    })
    .sort(
      (a, b) =>
        b.scoreBps - a.scoreBps ||
        b.testCoverage - a.testCoverage ||
        a.configurationId.localeCompare(b.configurationId),
    );
}

export function aggregateSnapshotMaterial(
  summaries: readonly ResultConfigurationSummary[],
) {
  return summaries
    .map((summary) => ({
      configurationId: summary.configurationId,
      contributorCount: summary.contributorCount,
      metadataHash: summary.metadataHash,
      q1ScoreBps: summary.q1ScoreBps,
      q3ScoreBps: summary.q3ScoreBps,
      scoreBps: summary.scoreBps,
      sourceSnapshotIds: summary.sourceSnapshotIds,
      testCoverage: summary.testCoverage,
    }))
    .sort((a, b) => a.configurationId.localeCompare(b.configurationId));
}

export function selectLatestEvaluationRows<
  T extends { evaluationVersion: number },
>(rows: readonly T[]): T[] {
  if (rows.length === 0) return [];
  const latest = Math.max(...rows.map((row) => row.evaluationVersion));
  return rows.filter((row) => row.evaluationVersion === latest);
}

export type ResultAggregateSnapshotStatus =
  | "building"
  | "published"
  | "superseded";

export function planResultAggregateSnapshotWrite(input: {
  existingStatus: ResultAggregateSnapshotStatus | null;
  existingVersion: number | null;
  latestVersion: number | null;
}) {
  if (input.existingStatus === "published") {
    return {
      publish: false,
      rewriteEntries: false,
      version: input.existingVersion,
    } as const;
  }
  return {
    publish: true,
    rewriteEntries:
      input.existingStatus === null || input.existingStatus === "building",
    version:
      input.existingVersion ?? Math.max(0, input.latestVersion ?? 0) + 1,
  } as const;
}

export function parseAggregateSourceSnapshotIds(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Stored result aggregate lineage is invalid.");
  }
  return [...new Set(parsed)].sort();
}
