import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerCli = join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const stateDir = mkdtempSync(join(tmpdir(), "benchmax-d1-invariants-"));

function wrangler(args, expectSuccess = true) {
  const result = spawnSync(
    process.execPath,
    [wranglerCli, ...args, "--local", "--persist-to", stateDir],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(stateDir, "wrangler.log"),
        WRANGLER_WRITE_LOGS: "false",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(result.status, 0, output);
  } else {
    assert.notEqual(result.status, 0, "A protected mutation unexpectedly succeeded.");
  }
  return output;
}

try {
  const migrationOutput = wrangler(["d1", "migrations", "apply", "DB"]);
  for (const migration of [
    "0000_colossal_shooting_star.sql",
    "0001_legal_sally_floyd.sql",
    "0002_ranked_run_core.sql",
    "0003_run_reports.sql",
    "0004_aggregate_leaderboards.sql",
    "0005_submission_rights.sql",
  ]) {
    assert.match(migrationOutput, new RegExp(migration.replaceAll(".", "\\.")));
  }

  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "INSERT INTO audit_events (id, actor_user_id, entity_type, entity_id, action, metadata_json, created_at) VALUES ('audit-probe', NULL, 'test', 'probe', 'created', '{}', 1);",
  ]);

  const blockedMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE audit_events SET action = 'tampered' WHERE id = 'audit-probe';",
    ],
    false,
  );
  assert.match(blockedMutation, /audit events are append-only/i);

  const integrityOutput = wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name; SELECT name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check;",
  ]);
  for (const trigger of [
    "audit_events_no_update",
    "audit_events_no_delete",
    "credit_ledger_no_update",
    "generation_records_no_update",
    "judge_samples_no_update",
    "objective_results_no_update",
    "moderation_actions_no_update",
    "benchmark_versions_frozen_after_run",
    "harnesses_frozen_when_referenced",
  ]) {
    assert.match(integrityOutput, new RegExp(trigger));
  }

  console.log("D1 migrations, foreign keys, append-only records, and frozen contracts verified.");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
