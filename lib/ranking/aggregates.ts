import { env } from "cloudflare:workers";
import { canonicalSha256 } from "@/lib/security/canonical";
import {
  buildAggregateEntries,
  selectDesignatedBenchmarkVersions,
  type BenchmarkAggregateInput,
  type RankingScope,
  type VersionedBenchmarkAggregateInput,
} from "./aggregate-math";

type Scope = RankingScope;
type BenchmarkEntry = BenchmarkAggregateInput;
type QueryBenchmarkEntry = VersionedBenchmarkAggregateInput;

export async function rebuildAggregateSnapshots(evaluationVersionId: string) {
  const result = await env.DB.prepare(
    `SELECT
       b.id AS benchmark_id,
       b.category,
       bv.version AS benchmark_version,
       le.configuration_id,
       le.median_score_bps,
       le.run_count,
       ls.id AS snapshot_id
     FROM leaderboard_entries le
     JOIN leaderboard_snapshots ls ON ls.id = le.snapshot_id
     JOIN benchmark_versions bv ON bv.id = ls.benchmark_version_id
     JOIN benchmarks b ON b.id = bv.benchmark_id
     WHERE ls.status = 'published' AND ls.evaluation_version_id = ?
     ORDER BY b.id, le.configuration_id`,
  )
    .bind(evaluationVersionId)
    .all<QueryBenchmarkEntry>();
  const rows = selectDesignatedBenchmarkVersions(result.results);
  if (rows.length === 0) return [];
  const snapshots = [];
  for (const scope of [
    "frontend",
    "browser-game",
    "browser-3d",
    "overall",
  ] as const) {
    const entries = buildAggregateEntries(rows, scope);
    if (entries.length === 0) continue;
    snapshots.push(
      await persistAggregateSnapshot(scope, evaluationVersionId, rows, entries),
    );
  }
  return snapshots;
}

async function persistAggregateSnapshot(
  scope: Scope,
  evaluationVersionId: string,
  sourceRows: readonly BenchmarkEntry[],
  entries: ReturnType<typeof buildAggregateEntries>,
) {
  const runSetHash = await canonicalSha256(
    sourceRows
      .filter((row) => scope === "overall" || row.category === scope)
      .map((row) => ({
        benchmarkId: row.benchmark_id,
        configurationId: row.configuration_id,
        medianScoreBps: row.median_score_bps,
        runCount: row.run_count,
        snapshotId: row.snapshot_id,
      })),
  );
  const existing = await env.DB.prepare(
    `SELECT id, version FROM aggregate_leaderboard_snapshots
     WHERE scope = ? AND evaluation_version_id = ? AND run_set_hash = ?
     LIMIT 1`,
  )
    .bind(scope, evaluationVersionId, runSetHash)
    .first<{ id: string; version: number }>();
  if (existing) return existing;
  const versionRow = await env.DB.prepare(
    `SELECT coalesce(max(version), 0) AS version
     FROM aggregate_leaderboard_snapshots
     WHERE scope = ? AND evaluation_version_id = ?`,
  )
    .bind(scope, evaluationVersionId)
    .first<{ version: number }>();
  const id = crypto.randomUUID();
  const version = Number(versionRow?.version ?? 0) + 1;
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      `INSERT INTO aggregate_leaderboard_snapshots
       (id, scope, evaluation_version_id, version, run_set_hash, status, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'building', NULL, ?)`,
    ).bind(id, scope, evaluationVersionId, version, runSetHash, now),
    ...entries.map((entry) =>
      env.DB.prepare(
        `INSERT INTO aggregate_leaderboard_entries
         (id, snapshot_id, configuration_id, rank, score_bps, benchmark_coverage, category_coverage, total_run_count, provisional, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        id,
        entry.configurationId,
        entry.rank,
        entry.scoreBps,
        entry.benchmarkCoverage,
        entry.categoryCoverage,
        entry.totalRunCount,
        entry.provisional ? 1 : 0,
        now,
      ),
    ),
    env.DB.prepare(
      `UPDATE aggregate_leaderboard_snapshots
       SET status = 'superseded'
       WHERE scope = ? AND evaluation_version_id = ? AND status = 'published'`,
    ).bind(scope, evaluationVersionId),
    env.DB.prepare(
      `UPDATE aggregate_leaderboard_snapshots
       SET status = 'published', published_at = ?
       WHERE id = ?`,
    ).bind(now, id),
  ];
  try {
    await env.DB.batch(statements);
    return { id, version };
  } catch (error) {
    const winner = await env.DB.prepare(
      `SELECT id, version FROM aggregate_leaderboard_snapshots
       WHERE scope = ? AND evaluation_version_id = ? AND run_set_hash = ?
       LIMIT 1`,
    )
      .bind(scope, evaluationVersionId, runSetHash)
      .first<{ id: string; version: number }>();
    if (winner) return winner;
    throw error;
  }
}
