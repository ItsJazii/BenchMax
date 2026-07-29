import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { leaderboardSnapshots, runs } from "@/db/schema";
import { canonicalSha256 } from "@/lib/security/canonical";
import { summarizeScores } from "./statistics";

export async function rebuildBenchmarkSnapshot(input: {
  benchmarkVersionId: string;
  evaluationVersionId: string;
}) {
  const rows = await getDb()
    .select({
      configurationId: runs.configurationId,
      id: runs.id,
      score: runs.overallScoreBps,
    })
    .from(runs)
    .where(
      and(
        eq(runs.benchmarkVersionId, input.benchmarkVersionId),
        eq(runs.evaluationVersionId, input.evaluationVersionId),
        eq(runs.status, "published"),
        eq(runs.rankEligible, true),
      ),
    );
  const validRows = rows
    .filter((row): row is typeof row & { score: number } => row.score !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (validRows.length === 0) return null;
  const runSetHash = await canonicalSha256(
    validRows.map((row) => ({ id: row.id, score: row.score })),
  );
  const [existing] = await getDb()
    .select()
    .from(leaderboardSnapshots)
    .where(
      and(
        eq(leaderboardSnapshots.benchmarkVersionId, input.benchmarkVersionId),
        eq(leaderboardSnapshots.evaluationVersionId, input.evaluationVersionId),
        eq(leaderboardSnapshots.runSetHash, runSetHash),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const groups = new Map<string, number[]>();
  for (const row of validRows) {
    const scores = groups.get(row.configurationId) ?? [];
    scores.push(row.score);
    groups.set(row.configurationId, scores);
  }
  const entries = [...groups.entries()]
    .map(([configurationId, scores]) => ({
      configurationId,
      ...summarizeScores(scores),
    }))
    .sort(
      (a, b) =>
        b.median - a.median ||
        b.runCount - a.runCount ||
        a.configurationId.localeCompare(b.configurationId),
    );
  const versionRow = await env.DB.prepare(
    `SELECT coalesce(max(version), 0) AS version
     FROM leaderboard_snapshots
     WHERE benchmark_version_id = ? AND evaluation_version_id = ?`,
  )
    .bind(input.benchmarkVersionId, input.evaluationVersionId)
    .first<{ version: number }>();
  const snapshotId = crypto.randomUUID();
  const version = Number(versionRow?.version ?? 0) + 1;
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      `INSERT INTO leaderboard_snapshots
        (id, benchmark_version_id, evaluation_version_id, version, run_set_hash, status, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'building', NULL, ?)`,
    ).bind(
      snapshotId,
      input.benchmarkVersionId,
      input.evaluationVersionId,
      version,
      runSetHash,
      now,
    ),
    ...entries.map((entry, index) =>
      env.DB.prepare(
        `INSERT INTO leaderboard_entries
          (id, snapshot_id, configuration_id, rank, median_score_bps, q1_score_bps, q3_score_bps, run_count, provisional, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        snapshotId,
        entry.configurationId,
        index + 1,
        entry.median,
        entry.q1,
        entry.q3,
        entry.runCount,
        entry.runCount < 3 ? 1 : 0,
        now,
      ),
    ),
    env.DB.prepare(
      `UPDATE leaderboard_snapshots
       SET status = 'superseded'
       WHERE benchmark_version_id = ? AND evaluation_version_id = ? AND status = 'published'`,
    ).bind(input.benchmarkVersionId, input.evaluationVersionId),
    env.DB.prepare(
      `UPDATE leaderboard_snapshots
       SET status = 'published', published_at = ?
       WHERE id = ? AND status = 'building'`,
    ).bind(now, snapshotId),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const [winner] = await getDb()
      .select()
      .from(leaderboardSnapshots)
      .where(
        and(
          eq(leaderboardSnapshots.benchmarkVersionId, input.benchmarkVersionId),
          eq(leaderboardSnapshots.evaluationVersionId, input.evaluationVersionId),
          eq(leaderboardSnapshots.runSetHash, runSetHash),
        ),
      )
      .limit(1);
    if (winner) return winner;
    throw error;
  }
  const [snapshot] = await getDb()
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.id, snapshotId))
    .limit(1);
  return snapshot;
}
