import { env } from "cloudflare:workers";

export async function listPublicConfigurations() {
  const result = await env.DB.prepare(
    `SELECT
       c.id,
       m.slug AS model_slug,
       m.name AS model_name,
       mv.version_label,
       p.name AS provider_name,
       c.endpoint_name,
       c.reasoning_level,
       c.settings_hash,
       h.name AS harness_name,
       h.version AS harness_version,
       count(CASE WHEN r.status = 'published' THEN 1 END) AS published_runs
     FROM configurations c
     JOIN providers p ON p.id = c.provider_id
     JOIN model_versions mv ON mv.id = c.model_version_id
     JOIN models m ON m.id = mv.model_id
     JOIN harnesses h ON h.id = c.harness_id
     LEFT JOIN runs r ON r.configuration_id = c.id
     WHERE c.status = 'active'
     GROUP BY c.id
     ORDER BY m.name, mv.version_label, c.reasoning_level`,
  ).all<{
    id: string;
    model_slug: string;
    model_name: string;
    version_label: string;
    provider_name: string;
    endpoint_name: string;
    reasoning_level: string;
    settings_hash: string;
    harness_name: string;
    harness_version: number;
    published_runs: number;
  }>();
  return result.results;
}

export async function listPublicBenchmarkVersions() {
  const result = await env.DB.prepare(
    `SELECT
       bv.id,
       b.slug,
       bv.title,
       bv.category,
       bv.version,
       bv.attempt_policy,
       bv.attempt_count,
       bv.environment_hash,
       h.name AS harness_name,
       h.version AS harness_version,
       count(r.id) AS run_count
     FROM benchmark_versions bv
     JOIN benchmarks b ON b.id = bv.benchmark_id
     JOIN harnesses h ON h.id = bv.harness_id
     LEFT JOIN runs r ON r.benchmark_version_id = bv.id
     WHERE b.status = 'active' AND bv.published_at IS NOT NULL
     GROUP BY bv.id
     ORDER BY bv.category, bv.title, bv.version DESC`,
  ).all<{
    id: string;
    slug: string;
    title: string;
    category: string;
    version: number;
    attempt_policy: string;
    attempt_count: number;
    environment_hash: string;
    harness_name: string;
    harness_version: number;
    run_count: number;
  }>();
  return result.results;
}

export async function getPublicModelPage(slug: string) {
  const model = await env.DB.prepare(
    `SELECT m.id, m.slug, m.name, p.name AS provider_name
     FROM models m
     JOIN providers p ON p.id = m.provider_id
     WHERE m.slug = ? AND m.status = 'active'
     LIMIT 1`,
  )
    .bind(slug)
    .first<{
      id: string;
      slug: string;
      name: string;
      provider_name: string;
    }>();
  if (!model) return null;
  const [configurations, history, aggregateResults] = await Promise.all([
    env.DB.prepare(
      `SELECT
         c.id, mv.version_label, mv.release_date, mv.training_cutoff,
         c.endpoint_name, c.reasoning_level, c.settings_hash,
         h.name AS harness_name, h.version AS harness_version
       FROM configurations c
       JOIN model_versions mv ON mv.id = c.model_version_id
       JOIN harnesses h ON h.id = c.harness_id
       WHERE mv.model_id = ? AND c.status = 'active'
       ORDER BY mv.version_label, c.reasoning_level`,
    )
      .bind(model.id)
      .all<Record<string, string | number | null>>(),
    env.DB.prepare(
      `SELECT
         c.id AS configuration_id,
         bv.title AS benchmark_title,
         bv.version AS benchmark_version,
         le.median_score_bps,
         le.q1_score_bps,
         le.q3_score_bps,
         le.run_count,
         ls.version AS snapshot_version,
         ls.published_at
       FROM leaderboard_entries le
       JOIN leaderboard_snapshots ls ON ls.id = le.snapshot_id
       JOIN benchmark_versions bv ON bv.id = ls.benchmark_version_id
       JOIN benchmarks b ON b.id = bv.benchmark_id
       JOIN configurations c ON c.id = le.configuration_id
       JOIN model_versions mv ON mv.id = c.model_version_id
       WHERE mv.model_id = ? AND ls.status IN ('published', 'superseded')
       ORDER BY ls.published_at DESC`,
    )
      .bind(model.id)
      .all<Record<string, string | number | null>>(),
    env.DB.prepare(
      `SELECT
         als.scope,
         ale.score_bps,
         ale.benchmark_coverage,
         ale.category_coverage,
         ale.total_run_count,
         ale.provisional,
         c.id AS configuration_id,
         c.reasoning_level,
         c.settings_hash,
         mv.version_label
       FROM aggregate_leaderboard_entries ale
       JOIN aggregate_leaderboard_snapshots als ON als.id = ale.snapshot_id
       JOIN configurations c ON c.id = ale.configuration_id
       JOIN model_versions mv ON mv.id = c.model_version_id
       WHERE mv.model_id = ? AND als.status = 'published'
       ORDER BY
         CASE als.scope
           WHEN 'overall' THEN 0
           WHEN 'frontend' THEN 1
           WHEN 'browser-game' THEN 2
           ELSE 3
         END,
         ale.score_bps DESC`,
    )
      .bind(model.id)
      .all<Record<string, string | number | null>>(),
  ]);
  return {
    model,
    configurations: configurations.results,
    history: history.results,
    aggregateResults: aggregateResults.results,
  };
}

export async function getPublicBenchmarkPage(slug: string) {
  const benchmark = await env.DB.prepare(
    `SELECT b.id, b.slug, bv.title, bv.category
     FROM benchmarks b
     JOIN benchmark_versions bv ON bv.benchmark_id = b.id
     WHERE b.slug = ?
       AND b.status = 'active'
       AND bv.published_at IS NOT NULL
     ORDER BY bv.version DESC
     LIMIT 1`,
  )
    .bind(slug)
    .first<{ id: string; slug: string; title: string; category: string }>();
  if (!benchmark) return null;
  const [versions, dimensions, results] = await Promise.all([
    env.DB.prepare(
      `SELECT
         bv.id, bv.version, bv.title, bv.goal, bv.success_criteria_json,
         bv.category, bv.canonical_prompt, bv.environment_hash,
         bv.attempt_policy, bv.attempt_count, bv.published_at,
         h.name AS harness_name, h.version AS harness_version,
         h.contract_hash
       FROM benchmark_versions bv
       JOIN harnesses h ON h.id = bv.harness_id
       WHERE bv.benchmark_id = ? AND bv.published_at IS NOT NULL
       ORDER BY bv.version DESC`,
    )
      .bind(benchmark.id)
      .all<Record<string, string | number | null>>(),
    env.DB.prepare(
      `SELECT rd.benchmark_version_id, rd.key, rd.title, rd.description,
              rd.mechanism, rd.weight_bps, rd.judge_source_required
       FROM rubric_dimensions rd
       JOIN benchmark_versions bv ON bv.id = rd.benchmark_version_id
       WHERE bv.benchmark_id = ? AND bv.published_at IS NOT NULL
       ORDER BY bv.version DESC, rd.ordinal`,
    )
      .bind(benchmark.id)
      .all<Record<string, string | number | null>>(),
    env.DB.prepare(
      `SELECT
         bv.version AS benchmark_version,
         le.rank, le.median_score_bps, le.q1_score_bps, le.q3_score_bps,
         le.run_count, le.provisional,
         m.name AS model_name, mv.version_label, c.reasoning_level,
         c.settings_hash
       FROM leaderboard_entries le
       JOIN leaderboard_snapshots ls ON ls.id = le.snapshot_id
       JOIN benchmark_versions bv ON bv.id = ls.benchmark_version_id
       JOIN configurations c ON c.id = le.configuration_id
       JOIN model_versions mv ON mv.id = c.model_version_id
       JOIN models m ON m.id = mv.model_id
       WHERE bv.benchmark_id = ? AND ls.status = 'published'
       ORDER BY bv.version DESC, le.rank`,
    )
      .bind(benchmark.id)
      .all<Record<string, string | number | null>>(),
  ]);
  return {
    benchmark,
    versions: versions.results,
    dimensions: dimensions.results,
    results: results.results,
  };
}

export async function comparePublicConfigurations(ids: string[]) {
  const safeIds = [
    ...new Set(
      ids.filter((id) => /^[a-z0-9][a-z0-9:._-]{2,159}$/.test(id)),
    ),
  ].slice(0, 4);
  if (safeIds.length === 0) return [];
  const placeholders = safeIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `WITH published_aggregates AS (
       SELECT
         ale.configuration_id,
         als.scope,
         ale.score_bps,
         ale.benchmark_coverage,
         ale.category_coverage,
         ale.total_run_count,
         ale.provisional
       FROM aggregate_leaderboard_entries ale
       JOIN aggregate_leaderboard_snapshots als ON als.id = ale.snapshot_id
       WHERE als.status = 'published'
     )
     SELECT
       c.id AS configuration_id, m.name AS model_name, mv.version_label,
       p.name AS provider_name, c.endpoint_name, c.reasoning_level,
       c.settings_hash, h.name AS harness_name, h.version AS harness_version,
       pa.scope, pa.score_bps, pa.benchmark_coverage,
       pa.category_coverage, pa.total_run_count, pa.provisional
     FROM configurations c
     JOIN providers p ON p.id = c.provider_id
     JOIN model_versions mv ON mv.id = c.model_version_id
     JOIN models m ON m.id = mv.model_id
     JOIN harnesses h ON h.id = c.harness_id
     LEFT JOIN published_aggregates pa ON pa.configuration_id = c.id
     WHERE c.id IN (${placeholders})
     ORDER BY c.id, pa.scope`,
  )
    .bind(...safeIds)
    .all<Record<string, string | number | null>>();
  return result.results;
}
