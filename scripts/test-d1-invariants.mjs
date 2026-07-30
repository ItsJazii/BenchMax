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
    "0006_evaluation_origin_pin.sql",
    "0007_generation_contract_freeze.sql",
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

  const contractFixture = [
    "INSERT INTO users (id, auth_subject, handle, display_name, created_at, updated_at) VALUES ('freeze-user', 'freeze-auth', 'freeze-user', 'Freeze User', 1, 1);",
    "INSERT INTO providers (id, slug, name, api_style, endpoint_origin, created_at, updated_at) VALUES ('freeze-provider', 'freeze-provider', 'Freeze Provider', 'openai-compatible', 'https://provider.example', 1, 1);",
    "INSERT INTO models (id, slug, name, provider, provider_id, created_at, updated_at) VALUES ('freeze-model', 'freeze-model', 'Freeze Model', 'Freeze Provider', 'freeze-provider', 1, 1);",
    "INSERT INTO model_versions (id, model_id, version_label, is_current, created_at, updated_at) VALUES ('freeze-model-version', 'freeze-model', 'v1', 1, 1, 1);",
    "INSERT INTO harnesses (id, slug, name, version, loop_version, tools_json, file_policy_json, context_budget_tokens, turn_limit, dependency_policy_json, contract_hash, status, created_at, updated_at) VALUES ('freeze-harness', 'freeze-harness', 'Freeze Harness', 1, 'v1', '[]', '{}', 1000, 1, '{}', 'freeze-harness-hash', 'active', 1, 1);",
    "INSERT INTO benchmarks (id, slug, title, category, status, created_at, updated_at) VALUES ('freeze-benchmark', 'freeze-benchmark', 'Freeze Benchmark', 'frontend', 'active', 1, 1);",
    "INSERT INTO benchmark_versions (id, benchmark_id, version, canonical_prompt, rubric_json, harness_id, harness_contract_json, environment_hash, dependency_lock_hash, interaction_script_hash, created_at, updated_at) VALUES ('freeze-benchmark-v1', 'freeze-benchmark', 1, 'prompt', '[]', 'freeze-harness', '{}', 'environment-hash', 'dependency-hash', 'interaction-hash', 1, 1);",
    "INSERT INTO configurations (id, provider_id, model_version_id, harness_id, endpoint_name, provider_model_id, reasoning_level, sampling_settings_json, settings_hash, max_output_tokens, status, created_at, updated_at) VALUES ('freeze-config', 'freeze-provider', 'freeze-model-version', 'freeze-harness', 'endpoint', 'model', 'low', '{}', 'settings-hash', 1000, 'active', 1, 1);",
    "INSERT INTO evaluation_versions (id, version, judge_provider, judge_model, judge_model_version, endpoint_origin, prompt_template, prompt_template_hash, rubric_protocol_version, sample_count, max_tokens_per_sample, calibration_set_hash, drift_threshold_bps, status, created_at, updated_at) VALUES ('freeze-evaluation', 99, 'provider', 'model', 'v1', 'https://judge.example', 'prompt', 'freeze-prompt-hash', 'rubric-v1', 3, 1000, 'freeze-calibration-hash', 100, 'active', 1, 1);",
    "INSERT INTO rubric_dimensions (id, benchmark_version_id, key, title, description, mechanism, weight_bps, judge_source_required, ordinal, created_at, updated_at) VALUES ('freeze-dimension', 'freeze-benchmark-v1', 'quality', 'Quality', 'Quality description', 'judge', 10000, 0, 1, 1, 1);",
    "INSERT INTO runs (id, public_slug, contributor_id, benchmark_version_id, configuration_id, evaluation_version_id, credential_mode, status, attempt_index, environment_hash, harness_contract_hash, rank_eligible, injection_flag, post_publication_marker, playable_enabled, created_at, updated_at) VALUES ('freeze-run', 'freeze-run', 'freeze-user', 'freeze-benchmark-v1', 'freeze-config', 'freeze-evaluation', 'byok', 'draft', 1, 'environment-hash', 'harness-hash', 0, 0, 0, 0, 1, 1);",
  ].join(" ");
  wrangler(["d1", "execute", "DB", "--command", contractFixture]);
  const blockedEvaluationMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE evaluation_versions SET endpoint_origin = 'https://changed.example' WHERE id = 'freeze-evaluation';",
    ],
    false,
  );
  assert.match(
    blockedEvaluationMutation,
    /evaluation version contract is frozen/i,
  );
  const blockedRubricMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE rubric_dimensions SET weight_bps = 9999 WHERE id = 'freeze-dimension';",
    ],
    false,
  );
  assert.match(blockedRubricMutation, /rubric dimensions are frozen/i);
  const blockedProviderMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE providers SET endpoint_origin = 'https://changed.example' WHERE id = 'freeze-provider';",
    ],
    false,
  );
  assert.match(blockedProviderMutation, /provider execution contract is frozen/i);
  const blockedConfigurationMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE configurations SET provider_model_id = 'changed-model' WHERE id = 'freeze-config';",
    ],
    false,
  );
  assert.match(
    blockedConfigurationMutation,
    /configuration contract is frozen/i,
  );
  const blockedModelVersionMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE model_versions SET version_label = 'changed-v2' WHERE id = 'freeze-model-version';",
    ],
    false,
  );
  assert.match(
    blockedModelVersionMutation,
    /model version contract is frozen/i,
  );
  const blockedBenchmarkMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE benchmarks SET category = 'browser-game' WHERE id = 'freeze-benchmark';",
    ],
    false,
  );
  assert.match(blockedBenchmarkMutation, /benchmark identity is frozen/i);
  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "INSERT INTO showcases (id, slug, owner_id, title, summary, category, model_label, harness, reasoning_level, prompt, source_visibility, rights_attested_at, status, safety_status, created_at, updated_at) VALUES ('quota-showcase', 'quota-showcase', 'freeze-user', 'Quota Showcase', 'Quota invariant fixture for upload session enforcement.', 'frontend', 'Kimi K3', 'Benchmax Web Agent', 'high', 'Build a test.', 'private', 1, 'draft', 'pending', 1, 1);",
  ]);
  const blockedKindSize = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO upload_sessions (id, user_id, showcase_id, artifact_kind, object_key, file_name, content_type, expected_bytes, token_digest, status, expires_at, created_at, updated_at) VALUES ('oversized-source', 'freeze-user', 'quota-showcase', 'source', 'quarantine/freeze-user/oversized-source/source.zip', 'source.zip', 'application/zip', 20971521, 'digest', 'created', 9999999999999, 1, 1);",
    ],
    false,
  );
  assert.match(blockedKindSize, /artifact kind size limit/i);
  for (const index of [1, 2]) {
    wrangler([
      "d1",
      "execute",
      "DB",
      "--command",
      `INSERT INTO upload_sessions (id, user_id, showcase_id, artifact_kind, object_key, file_name, content_type, expected_bytes, token_digest, status, expires_at, created_at, updated_at) VALUES ('quota-video-${index}', 'freeze-user', 'quota-showcase', 'video', 'quarantine/freeze-user/quota-video-${index}/video.webm', 'video.webm', 'video/webm', 419430400, 'digest-${index}', 'created', 9999999999999, 1, 1);`,
    ]);
  }
  const blockedSubmissionQuota = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO upload_sessions (id, user_id, showcase_id, artifact_kind, object_key, file_name, content_type, expected_bytes, token_digest, status, expires_at, created_at, updated_at) VALUES ('quota-video-3', 'freeze-user', 'quota-showcase', 'video', 'quarantine/freeze-user/quota-video-3/video.webm', 'video.webm', 'video/webm', 419430400, 'digest-3', 'created', 9999999999999, 1, 1);",
    ],
    false,
  );
  assert.match(blockedSubmissionQuota, /submission storage quota/i);

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
    "evaluation_versions_frozen_after_run",
    "rubric_dimensions_frozen_after_run_update",
    "rubric_dimensions_frozen_after_run_delete",
    "rubric_dimensions_frozen_after_run_insert",
    "harnesses_frozen_when_referenced",
    "providers_frozen_after_run",
    "model_versions_frozen_after_run",
    "models_frozen_after_run",
    "configurations_frozen_after_run",
    "benchmarks_frozen_after_run",
    "upload_sessions_kind_size_policy",
    "upload_sessions_submission_quota",
    "upload_sessions_account_quota",
  ]) {
    assert.match(integrityOutput, new RegExp(trigger));
  }

  console.log("D1 migrations, foreign keys, append-only records, and frozen contracts verified.");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
