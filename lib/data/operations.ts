import { env } from "cloudflare:workers";
import { getDailySpendSummary } from "@/lib/data/result-spend";
import { canonicalJson } from "@/lib/security/canonical";
import { sha256Hex } from "@/lib/security/policy";

export async function getOperationsSnapshot() {
  const dayStartedAt = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const [
    lifecycle,
    stages,
    evaluations,
    judgeBudget,
    judgeUsage,
    overdue,
    catalogRequests,
    disputes,
    reports,
    recentAudit,
    dailySpend,
    storage,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT status, count(*) AS count FROM runs GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT stage, status, count(*) AS count, max(attempt_count) AS max_attempts
       FROM run_stage_claims GROUP BY stage, status ORDER BY stage, status`,
    ).all<{
      stage: string;
      status: string;
      count: number;
      max_attempts: number;
    }>(),
    env.DB.prepare(
      `SELECT id, version, judge_model, judge_model_version, status, updated_at
       FROM evaluation_versions ORDER BY version DESC`,
    ).all<{
      id: string;
      version: number;
      judge_model: string;
      judge_model_version: string;
      status: string;
      updated_at: number;
    }>(),
    env.DB.prepare(
      `SELECT
         count(DISTINCT run_id) AS reserved_runs,
         coalesce(sum(sample_count), 0) AS reserved_samples,
         coalesce(sum(CASE WHEN purpose = 'initial' THEN 1 ELSE 0 END), 0)
           AS initial_results
       FROM judge_budget_reservations
       WHERE day_started_at = ?`,
    )
      .bind(dayStartedAt)
      .first<{
        initial_results: number;
        reserved_runs: number;
        reserved_samples: number;
      }>(),
    env.DB.prepare(
      `SELECT
         count(*) AS completed_samples,
         coalesce(sum(input_tokens), 0) AS input_tokens,
         coalesce(sum(output_tokens), 0) AS output_tokens
       FROM judge_samples
       WHERE created_at >= ?`,
    )
      .bind(dayStartedAt)
      .first<{
        completed_samples: number;
        input_tokens: number;
        output_tokens: number;
      }>(),
    env.DB.prepare(
      `SELECT
         count(*) AS overdue_results,
         min(judge_due_at) AS oldest_due_at
       FROM showcases
       WHERE status = 'published'
         AND safety_status = 'approved'
         AND judge_status = 'overdue'`,
    ).first<{ oldest_due_at: number | null; overdue_results: number }>(),
    env.DB.prepare(
      `SELECT kind, status, count(*) AS count
       FROM catalog_requests GROUP BY kind, status ORDER BY kind, status`,
    ).all<{ kind: string; status: string; count: number }>(),
    env.DB.prepare(
      `SELECT status, count(*) AS count FROM disputes GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT status, count(*) AS count FROM abuse_reports GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT
         action,
         entity_type,
         entity_id,
         actor_user_id,
         metadata_json,
         created_at
       FROM audit_events
       ORDER BY created_at DESC
       LIMIT 100`,
    ).all<{
      action: string;
      entity_type: string;
      entity_id: string;
      actor_user_id: string | null;
      metadata_json: string;
      created_at: number;
    }>(),
    getDailySpendSummary(new Date(dayStartedAt)),
    summarizeStorage(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    lifecycle: lifecycle.results,
    stages: stages.results,
    evaluations: evaluations.results,
    judgeBudget: {
      configuredDailySamples:
        positiveInteger(process.env.BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET),
      dayStartedAt: new Date(dayStartedAt).toISOString(),
      reservedRuns: Number(judgeBudget?.reserved_runs ?? 0),
      reservedSamples: Number(judgeBudget?.reserved_samples ?? 0),
      initialResults: Number(judgeBudget?.initial_results ?? 0),
      completedSamples: Number(judgeUsage?.completed_samples ?? 0),
      inputTokens: Number(judgeUsage?.input_tokens ?? 0),
      outputTokens: Number(judgeUsage?.output_tokens ?? 0),
    },
    overdue: {
      count: Number(overdue?.overdue_results ?? 0),
      oldestDueAt:
        overdue?.oldest_due_at === null || overdue?.oldest_due_at === undefined
          ? null
          : new Date(Number(overdue.oldest_due_at)).toISOString(),
    },
    catalogRequests: catalogRequests.results,
    disputes: disputes.results,
    reports: reports.results,
    recentAudit: recentAudit.results.map((event) => ({
      action: event.action,
      entityType: event.entity_type,
      entityId: event.entity_id,
      actorUserId: event.actor_user_id,
      metadata: parseAuditMetadata(event.metadata_json),
      createdAt: new Date(Number(event.created_at)).toISOString(),
    })),
    spend: dailySpend,
    storage,
  };
}

function parseAuditMetadata(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function writeBackupManifest(actorUserId: string) {
  const snapshot = await getOperationsSnapshot();
  const tableCounts = await env.DB.prepare(
    `SELECT 'users' AS table_name, count(*) AS count FROM users
     UNION ALL SELECT 'showcases', count(*) FROM showcases
     UNION ALL SELECT 'artifacts', count(*) FROM artifacts
     UNION ALL SELECT 'runs', count(*) FROM runs
     UNION ALL SELECT 'run_artifacts', count(*) FROM run_artifacts
     UNION ALL SELECT 'generation_records', count(*) FROM generation_records
     UNION ALL SELECT 'legacy_generation_funding_history', count(*) FROM legacy_generation_funding_history
     UNION ALL SELECT 'catalog_requests', count(*) FROM catalog_requests
     UNION ALL SELECT 'result_configurations', count(*) FROM result_configurations
     UNION ALL SELECT 'result_leaderboard_snapshots', count(*) FROM result_leaderboard_snapshots
     UNION ALL SELECT 'result_leaderboard_entries', count(*) FROM result_leaderboard_entries
     UNION ALL SELECT 'result_aggregate_snapshots', count(*) FROM result_aggregate_snapshots
     UNION ALL SELECT 'result_aggregate_entries', count(*) FROM result_aggregate_entries
     UNION ALL SELECT 'judge_budget_reservations', count(*) FROM judge_budget_reservations
     UNION ALL SELECT 'result_spend_records', count(*) FROM result_spend_records
     UNION ALL SELECT 'audit_events', count(*) FROM audit_events
     UNION ALL SELECT 'leaderboard_snapshots', count(*) FROM leaderboard_snapshots
     UNION ALL SELECT 'aggregate_leaderboard_snapshots', count(*) FROM aggregate_leaderboard_snapshots`,
  ).all<{ table_name: string; count: number }>();
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedByUserId: actorUserId,
    d1: {
      tableCounts: tableCounts.results,
      restoreMethod:
        "Cloudflare D1 Time Travel or an authenticated wrangler d1 export captured by the operator runbook.",
    },
    r2: snapshot.storage,
  };
  const json = canonicalJson(manifest);
  const sha256 = await sha256Hex(json);
  const objectKey = `private/backups/manifests/${Date.now()}-${sha256}.json`;
  await env.UPLOADS.put(objectKey, json, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, version: "1" },
  });
  return { objectKey, sha256 };
}

async function summarizeStorage() {
  const prefixes = [
    "quarantine/",
    "showcases/",
    "runs/",
    "private/backups/",
  ];
  const summaries = [];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    let objects = 0;
    let bytes = 0;
    let truncated = false;
    do {
      const page = await env.UPLOADS.list({
        prefix,
        limit: 1000,
        cursor,
      });
      objects += page.objects.length;
      bytes += page.objects.reduce((sum, object) => sum + object.size, 0);
      cursor = page.truncated ? page.cursor : undefined;
      if (objects >= 100_000 && cursor) {
        truncated = true;
        break;
      }
    } while (cursor);
    summaries.push({ prefix, objects, bytes, truncated });
  }
  return summaries;
}
