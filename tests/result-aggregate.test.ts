import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateSnapshotMaterial,
  buildResultConfigurationSummaries,
  parseAggregateSourceSnapshotIds,
  planResultAggregateSnapshotWrite,
  selectLatestEvaluationRows,
  type ResultAggregateInput,
} from "../lib/ranking/result-aggregate-math";

function row(
  overrides: Partial<ResultAggregateInput> = {},
): ResultAggregateInput {
  return {
    contributorId: "user-a",
    declaredSettings: { temperature: 0 },
    harnessLabel: "Codex",
    metadataHash: "metadata-a",
    modelLabel: "Example",
    modelSlug: "example",
    modelVersionLabel: "example-1",
    reasoning: "high",
    resultConfigurationId: "config-a",
    scoreBps: 5_000,
    snapshotId: "snapshot-a",
    snapshotPublishedAt: new Date("2026-07-30T00:00:00.000Z"),
    testVersionId: "test-a-v1",
    ...overrides,
  };
}

test("configuration summaries equal-weight test medians and expose coverage, N, and IQR", () => {
  const summaries = buildResultConfigurationSummaries([
    row({ contributorId: "a", scoreBps: 9_000 }),
    row({ contributorId: "b", scoreBps: 7_000 }),
    row({ contributorId: "c", scoreBps: 8_000 }),
    row({
      contributorId: "a",
      scoreBps: 2_000,
      snapshotId: "snapshot-b",
      testVersionId: "test-b-v1",
    }),
  ]);
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0], {
    configurationId: "config-a",
    contributorCount: 3,
    declaredSettings: { temperature: 0 },
    harnessLabel: "Codex",
    metadataHash: "metadata-a",
    modelLabel: "Example",
    modelSlug: "example",
    modelVersionLabel: "example-1",
    provisional: true,
    q1ScoreBps: 3_500,
    q3ScoreBps: 6_500,
    reasoning: "high",
    scoreBps: 5_000,
    snapshotDate: new Date("2026-07-30T00:00:00.000Z"),
    sourceSnapshotIds: ["snapshot-a", "snapshot-b"],
    testCoverage: 2,
  });
});

test("aggregate snapshot material is independent of query row order", () => {
  const inputs = [
    row(),
    row({
      resultConfigurationId: "config-b",
      modelVersionLabel: "example-2",
      scoreBps: 6_000,
    }),
  ];
  const forward = aggregateSnapshotMaterial(
    buildResultConfigurationSummaries(inputs),
  );
  const reverse = aggregateSnapshotMaterial(
    buildResultConfigurationSummaries(inputs.toReversed()),
  );
  assert.deepEqual(reverse, forward);
});

test("public ranking inputs never mix pinned evaluation versions", () => {
  const selected = selectLatestEvaluationRows([
    { evaluationVersion: 1, snapshot: "old-a" },
    { evaluationVersion: 2, snapshot: "new-a" },
    { evaluationVersion: 1, snapshot: "old-b" },
    { evaluationVersion: 2, snapshot: "new-b" },
  ]);
  assert.deepEqual(
    selected.map((item) => item.snapshot),
    ["new-a", "new-b"],
  );
  assert.deepEqual(selectLatestEvaluationRows([]), []);
});

test("aggregate snapshot publication is versioned and safely resumable", () => {
  assert.deepEqual(
    planResultAggregateSnapshotWrite({
      existingStatus: null,
      existingVersion: null,
      latestVersion: 4,
    }),
    { publish: true, rewriteEntries: true, version: 5 },
  );
  assert.deepEqual(
    planResultAggregateSnapshotWrite({
      existingStatus: "building",
      existingVersion: 5,
      latestVersion: 5,
    }),
    { publish: true, rewriteEntries: true, version: 5 },
  );
  assert.deepEqual(
    planResultAggregateSnapshotWrite({
      existingStatus: "superseded",
      existingVersion: 3,
      latestVersion: 5,
    }),
    { publish: true, rewriteEntries: false, version: 3 },
  );
  assert.deepEqual(
    planResultAggregateSnapshotWrite({
      existingStatus: "published",
      existingVersion: 5,
      latestVersion: 5,
    }),
    { publish: false, rewriteEntries: false, version: 5 },
  );
});

test("aggregate source lineage is validated, deduplicated, and ordered", () => {
  assert.deepEqual(
    parseAggregateSourceSnapshotIds('["snapshot-b","snapshot-a","snapshot-b"]'),
    ["snapshot-a", "snapshot-b"],
  );
  assert.throws(
    () => parseAggregateSourceSnapshotIds('["snapshot-a",42]'),
    /lineage is invalid/,
  );
  assert.throws(
    () => parseAggregateSourceSnapshotIds('{"snapshot":"a"}'),
    /lineage is invalid/,
  );
});
