import { env } from "cloudflare:workers";

export type FrontendLeaderboardRow = {
  benchmarkTitle: string;
  benchmarkVersion: number;
  configurationId: string;
  endpointName: string;
  evaluationVersion: number;
  harnessName: string;
  harnessVersion: number;
  medianScoreBps: number;
  modelName: string;
  modelVersion: string;
  provisional: boolean;
  providerName: string;
  q1ScoreBps: number;
  q3ScoreBps: number;
  rank: number;
  reasoningLevel: string;
  runCount: number;
  settingsHash: string;
  snapshotPublishedAt: number;
};

export async function listFrontendLeaderboard(): Promise<
  FrontendLeaderboardRow[]
> {
  const result = await env.DB.prepare(
    `SELECT
       b.title AS benchmark_title,
       bv.version AS benchmark_version,
       le.configuration_id,
       c.endpoint_name,
       ev.version AS evaluation_version,
       h.name AS harness_name,
       h.version AS harness_version,
       le.median_score_bps,
       m.name AS model_name,
       mv.version_label AS model_version,
       le.provisional,
       p.name AS provider_name,
       le.q1_score_bps,
       le.q3_score_bps,
       le.rank,
       c.reasoning_level,
       le.run_count,
       c.settings_hash,
       ls.published_at AS snapshot_published_at
     FROM leaderboard_entries le
     JOIN leaderboard_snapshots ls ON ls.id = le.snapshot_id
     JOIN benchmark_versions bv ON bv.id = ls.benchmark_version_id
     JOIN benchmarks b ON b.id = bv.benchmark_id
     JOIN evaluation_versions ev ON ev.id = ls.evaluation_version_id
     JOIN configurations c ON c.id = le.configuration_id
     JOIN providers p ON p.id = c.provider_id
     JOIN model_versions mv ON mv.id = c.model_version_id
     JOIN models m ON m.id = mv.model_id
     JOIN harnesses h ON h.id = c.harness_id
     WHERE ls.status = 'published' AND b.category = 'frontend'
     ORDER BY b.title ASC, le.rank ASC`,
  ).all<{
    benchmark_title: string;
    benchmark_version: number;
    configuration_id: string;
    endpoint_name: string;
    evaluation_version: number;
    harness_name: string;
    harness_version: number;
    median_score_bps: number;
    model_name: string;
    model_version: string;
    provisional: number;
    provider_name: string;
    q1_score_bps: number;
    q3_score_bps: number;
    rank: number;
    reasoning_level: string;
    run_count: number;
    settings_hash: string;
    snapshot_published_at: number;
  }>();
  return result.results.map((row) => ({
    benchmarkTitle: row.benchmark_title,
    benchmarkVersion: row.benchmark_version,
    configurationId: row.configuration_id,
    endpointName: row.endpoint_name,
    evaluationVersion: row.evaluation_version,
    harnessName: row.harness_name,
    harnessVersion: row.harness_version,
    medianScoreBps: row.median_score_bps,
    modelName: row.model_name,
    modelVersion: row.model_version,
    provisional: Boolean(row.provisional),
    providerName: row.provider_name,
    q1ScoreBps: row.q1_score_bps,
    q3ScoreBps: row.q3_score_bps,
    rank: row.rank,
    reasoningLevel: row.reasoning_level,
    runCount: row.run_count,
    settingsHash: row.settings_hash,
    snapshotPublishedAt: row.snapshot_published_at,
  }));
}

export async function listAggregateLeaderboard(
  scope: "frontend" | "browser-game" | "browser-3d" | "overall",
) {
  const result = await env.DB.prepare(
    `SELECT
       ale.rank,
       ale.score_bps,
       ale.benchmark_coverage,
       ale.category_coverage,
       ale.total_run_count,
       ale.provisional,
       als.version AS snapshot_version,
       als.published_at,
       c.id AS configuration_id,
       c.reasoning_level,
       c.settings_hash,
       c.endpoint_name,
       p.name AS provider_name,
       m.name AS model_name,
       mv.version_label,
       h.name AS harness_name,
       h.version AS harness_version
     FROM aggregate_leaderboard_entries ale
     JOIN aggregate_leaderboard_snapshots als ON als.id = ale.snapshot_id
     JOIN configurations c ON c.id = ale.configuration_id
     JOIN providers p ON p.id = c.provider_id
     JOIN model_versions mv ON mv.id = c.model_version_id
     JOIN models m ON m.id = mv.model_id
     JOIN harnesses h ON h.id = c.harness_id
     WHERE als.scope = ? AND als.status = 'published'
     ORDER BY ale.rank`,
  )
    .bind(scope)
    .all<{
      rank: number;
      score_bps: number;
      benchmark_coverage: number;
      category_coverage: number;
      total_run_count: number;
      provisional: number;
      snapshot_version: number;
      published_at: number;
      configuration_id: string;
      reasoning_level: string;
      settings_hash: string;
      endpoint_name: string;
      provider_name: string;
      model_name: string;
      version_label: string;
      harness_name: string;
      harness_version: number;
    }>();
  return result.results;
}
