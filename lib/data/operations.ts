import { env } from "cloudflare:workers";
import { canonicalJson } from "@/lib/security/canonical";
import { sha256Hex } from "@/lib/security/policy";

export async function getOperationsSnapshot() {
  const [
    lifecycle,
    stages,
    evaluations,
    disputes,
    reports,
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
      `SELECT status, count(*) AS count FROM disputes GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT status, count(*) AS count FROM abuse_reports GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    summarizeStorage(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    lifecycle: lifecycle.results,
    stages: stages.results,
    evaluations: evaluations.results,
    disputes: disputes.results,
    reports: reports.results,
    storage,
  };
}

export async function writeBackupManifest(actorUserId: string) {
  const snapshot = await getOperationsSnapshot();
  const tableCounts = await env.DB.prepare(
    `SELECT 'users' AS table_name, count(*) AS count FROM users
     UNION ALL SELECT 'showcases', count(*) FROM showcases
     UNION ALL SELECT 'artifacts', count(*) FROM artifacts
     UNION ALL SELECT 'runs', count(*) FROM runs
     UNION ALL SELECT 'run_artifacts', count(*) FROM run_artifacts
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
