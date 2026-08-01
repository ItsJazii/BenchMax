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
    "0008_community_results_pivot.sql",
    "0009_community_test_categories.sql",
    "0010_result_leaderboard_snapshots.sql",
    "0011_catalog_request_config_links.sql",
    "0012_judge_budget_reservations.sql",
    "0013_result_aggregate_snapshots.sql",
    "0014_immutable_test_versions.sql",
    "0015_legacy_pipeline_seal.sql",
    "0016_result_spend_records.sql",
    "0017_result_snapshot_immutability.sql",
    "0018_catalog_configuration_canonicalization.sql",
    "0019_catalog_request_fk_legacy_run_seal.sql",
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
    "INSERT INTO benchmark_versions (id, benchmark_id, version, title, goal, success_criteria_json, category, canonical_prompt, rubric_json, harness_id, harness_contract_json, environment_hash, dependency_lock_hash, interaction_script_hash, created_at, updated_at) VALUES ('freeze-benchmark-v1', 'freeze-benchmark', 1, 'Freeze Benchmark', 'Exercise the freeze contract.', '[\"The result is correct.\"]', 'frontend', 'prompt', '[]', 'freeze-harness', '{}', 'environment-hash', 'dependency-hash', 'interaction-hash', 1, 1);",
    "INSERT INTO configurations (id, provider_id, model_version_id, harness_id, endpoint_name, provider_model_id, reasoning_level, sampling_settings_json, settings_hash, max_output_tokens, status, created_at, updated_at) VALUES ('freeze-config', 'freeze-provider', 'freeze-model-version', 'freeze-harness', 'endpoint', 'model', 'low', '{}', 'settings-hash', 1000, 'active', 1, 1);",
    "INSERT INTO result_configurations (id, model_version_id, harness_id, model_label, model_version_label, harness_label, reasoning_raw, reasoning_normalized, declared_settings_json, metadata_hash, catalog_status, created_at, updated_at) VALUES ('freeze-result-config', 'freeze-model-version', 'freeze-harness', 'Freeze Model', 'v1', 'Freeze Harness v1', 'low', 'low', '{}', 'freeze-result-config-hash', 'canonical', 1, 1);",
    "INSERT INTO evaluation_versions (id, version, judge_provider, judge_model, judge_model_version, endpoint_origin, prompt_template, prompt_template_hash, rubric_protocol_version, sample_count, max_tokens_per_sample, calibration_set_hash, drift_threshold_bps, status, created_at, updated_at) VALUES ('freeze-evaluation', 99, 'provider', 'model', 'v1', 'https://judge.example', 'prompt', 'freeze-prompt-hash', 'rubric-v1', 3, 1000, 'freeze-calibration-hash', 100, 'active', 1, 1);",
    "INSERT INTO rubric_dimensions (id, benchmark_version_id, key, title, description, mechanism, weight_bps, judge_source_required, ordinal, created_at, updated_at) VALUES ('freeze-dimension', 'freeze-benchmark-v1', 'quality', 'Quality', 'Quality description', 'judge', 10000, 0, 1, 1, 1);",
    "UPDATE benchmark_versions SET published_at = 2, updated_at = 2 WHERE id = 'freeze-benchmark-v1';",
    "INSERT INTO showcases (id, slug, owner_id, title, summary, category, benchmark_version_id, result_configuration_id, model_label, harness, reasoning_level, prompt, source_visibility, rights_attested_at, status, safety_status, judge_status, ranking_status, published_at, created_at, updated_at) VALUES ('freeze-showcase', 'freeze-showcase', 'freeze-user', 'Freeze Showcase', 'Snapshot immutability fixture.', 'frontend', 'freeze-benchmark-v1', 'freeze-result-config', 'Freeze Model', 'Freeze Harness v1', 'low', 'prompt', 'private', 1, 'published', 'approved', 'scored', 'eligible', 2, 1, 2);",
    "INSERT INTO runs (id, public_slug, contributor_id, benchmark_version_id, configuration_id, evaluation_version_id, credential_mode, status, attempt_index, environment_hash, harness_contract_hash, rank_eligible, injection_flag, post_publication_marker, playable_enabled, created_at, updated_at) VALUES ('freeze-run', 'freeze-run', 'freeze-user', 'freeze-benchmark-v1', 'freeze-config', 'freeze-evaluation', 'community-submission', 'queued_evaluation', 1, 'environment-hash', 'harness-hash', 0, 0, 0, 0, 1, 1);",
  ].join(" ");
  wrangler(["d1", "execute", "DB", "--command", contractFixture]);
  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "INSERT INTO result_configurations (id, model_version_id, harness_id, model_label, model_version_label, harness_label, reasoning_raw, reasoning_normalized, declared_settings_json, metadata_hash, catalog_status, created_at, updated_at) VALUES ('pending-result-config', 'freeze-model-version', 'freeze-harness', 'Pending Model', 'v1', 'Freeze Harness v1', 'low', 'low', '{}', 'pending-result-config-hash', 'pending', 1, 1);",
  ]);
  const blockedPendingHashMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET metadata_hash = 'tampered-pending-hash' WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(blockedPendingHashMutation, /declared result metadata is immutable/i);
  const blockedPendingDeclaredMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET declared_settings_json = '{\"temperature\":1}' WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(blockedPendingDeclaredMutation, /declared result metadata is immutable/i);
  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "UPDATE result_configurations SET catalog_status = 'canonical', metadata_hash = 'canonical-result-config-hash', updated_at = 2 WHERE id = 'pending-result-config';",
  ]);
  const blockedCanonicalMetadataMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET metadata_hash = 'tampered-result-config-hash' WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(
    blockedCanonicalMetadataMutation,
    /declared result metadata is immutable/i,
  );
  const blockedCanonicalDeclaredMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET model_label = 'Tampered Model' WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(
    blockedCanonicalDeclaredMutation,
    /declared result metadata is immutable/i,
  );
  const blockedCanonicalIdentityMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET model_version_id = NULL WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(
    blockedCanonicalIdentityMutation,
    /declared result metadata is immutable/i,
  );
  const blockedCanonicalStatusReopen = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_configurations SET catalog_status = 'rejected' WHERE id = 'pending-result-config';",
    ],
    false,
  );
  assert.match(blockedCanonicalStatusReopen, /catalog status cannot be reopened/i);
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
  const blockedPublishedVersionMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE benchmark_versions SET title = 'Tampered' WHERE id = 'freeze-benchmark-v1';",
    ],
    false,
  );
  assert.match(
    blockedPublishedVersionMutation,
    /published benchmark versions are immutable/i,
  );

  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "INSERT INTO result_spend_records (id, run_id, evaluation_version_id, service, operation, attempt_key, sample_index, status, currency, cost_microusd, input_tokens, output_tokens, duration_ms, pricing_snapshot_json, pricing_snapshot_hash, usage_json, created_at) VALUES ('spend-probe', 'freeze-run', 'freeze-evaluation', 'judge', 'judge-sample', 'spend-probe-attempt', 1, 'completed', 'USD', 42, 100, 10, 250, '{\"version\":1}', 'pricing-hash', '{\"version\":1}', 1);",
  ]);
  const blockedSpendMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_spend_records SET cost_microusd = 0 WHERE id = 'spend-probe';",
    ],
    false,
  );
  assert.match(blockedSpendMutation, /result spend records are append-only/i);
  const blockedSpendDelete = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "DELETE FROM result_spend_records WHERE id = 'spend-probe';",
    ],
    false,
  );
  assert.match(blockedSpendDelete, /result spend records are append-only/i);

  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    [
      "INSERT INTO result_leaderboard_snapshots (id, benchmark_version_id, evaluation_version_id, version, result_set_hash, status, published_at, created_at) VALUES ('sealed-result-snapshot', 'freeze-benchmark-v1', 'freeze-evaluation', 1, 'sealed-result-set', 'building', NULL, 1);",
      "INSERT INTO result_leaderboard_entries (id, snapshot_id, showcase_id, run_id, rank, score_bps, sample_count, created_at) VALUES ('sealed-result-entry', 'sealed-result-snapshot', 'freeze-showcase', 'freeze-run', 1, 9000, 3, 1);",
      "UPDATE result_leaderboard_snapshots SET status = 'published', published_at = 2 WHERE id = 'sealed-result-snapshot';",
      "INSERT INTO result_aggregate_snapshots (id, evaluation_version_id, version, source_set_hash, status, published_at, created_at) VALUES ('sealed-aggregate-snapshot', 'freeze-evaluation', 1, 'sealed-source-set', 'building', NULL, 1);",
      "INSERT INTO result_aggregate_entries (id, snapshot_id, result_configuration_id, score_bps, q1_score_bps, q3_score_bps, test_coverage, contributor_count, provisional, source_snapshot_ids_json, created_at) VALUES ('sealed-aggregate-entry', 'sealed-aggregate-snapshot', 'freeze-result-config', 9000, 8500, 9500, 1, 1, 1, '[\"sealed-result-snapshot\"]', 1);",
      "UPDATE result_aggregate_snapshots SET status = 'published', published_at = 2 WHERE id = 'sealed-aggregate-snapshot';",
    ].join(" "),
  ]);
  const blockedResultEntryMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_leaderboard_entries SET score_bps = 1 WHERE id = 'sealed-result-entry';",
    ],
    false,
  );
  assert.match(blockedResultEntryMutation, /result leaderboard entries are immutable/i);
  const blockedResultSnapshotReopen = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_leaderboard_snapshots SET status = 'building' WHERE id = 'sealed-result-snapshot';",
    ],
    false,
  );
  assert.match(blockedResultSnapshotReopen, /cannot be reopened/i);
  const blockedAggregateEntryDelete = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "DELETE FROM result_aggregate_entries WHERE id = 'sealed-aggregate-entry';",
    ],
    false,
  );
  assert.match(blockedAggregateEntryDelete, /result aggregate entries are immutable/i);
  const blockedAggregateSnapshotMutation = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE result_aggregate_snapshots SET source_set_hash = 'tampered' WHERE id = 'sealed-aggregate-snapshot';",
    ],
    false,
  );
  assert.match(blockedAggregateSnapshotMutation, /result aggregate snapshots are immutable/i);

  const blockedLegacyFundingInsert = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO legacy_generation_funding_history (id, user_id, run_id, type, amount_milli_units, idempotency_key, metadata_json, actor_user_id, created_at) VALUES ('legacy-funding-probe', 'freeze-user', 'freeze-run', 'generation-charge', -1, 'legacy-funding-probe', '{}', NULL, 1);",
    ],
    false,
  );
  assert.match(blockedLegacyFundingInsert, /generation funding history is sealed/i);

  const blockedGenerationRecordInsert = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO generation_records (id, run_id, request_hash, response_hash, provenance_hash, encrypted_envelope_object_key, encrypted_envelope_sha256, redacted_transcript, duration_ms, harness_turn_count, created_at) VALUES ('generation-probe', 'freeze-run', 'request', 'response', 'provenance', 'envelope', 'sha', 'redacted', 1, 1, 1);",
    ],
    false,
  );
  assert.match(blockedGenerationRecordInsert, /generation records are sealed/i);
  wrangler([
    "d1",
    "execute",
    "DB",
    "--command",
    "DROP TRIGGER generation_records_no_insert; INSERT INTO generation_records (id, run_id, request_hash, response_hash, provenance_hash, encrypted_envelope_object_key, encrypted_envelope_sha256, redacted_transcript, duration_ms, harness_turn_count, created_at) VALUES ('generation-probe', 'freeze-run', 'request', 'response', 'provenance', 'envelope', 'sha', 'redacted', 1, 1, 1); CREATE TRIGGER generation_records_no_insert BEFORE INSERT ON generation_records BEGIN SELECT RAISE(ABORT, 'legacy generation records are sealed'); END;",
  ]);
  const blockedGenerationRecordUpdate = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE generation_records SET response_hash = 'tampered' WHERE id = 'generation-probe';",
    ],
    false,
  );
  assert.match(blockedGenerationRecordUpdate, /generation records are sealed/i);
  const blockedGenerationRecordDelete = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "DELETE FROM generation_records WHERE id = 'generation-probe';",
    ],
    false,
  );
  assert.match(blockedGenerationRecordDelete, /generation records are sealed/i);

  const blockedLegacyCredentialInsert = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO runs (id, public_slug, contributor_id, benchmark_version_id, configuration_id, evaluation_version_id, credential_mode, status, attempt_index, environment_hash, harness_contract_hash, rank_eligible, injection_flag, post_publication_marker, playable_enabled, created_at, updated_at) VALUES ('legacy-run-probe', 'legacy-run-probe', 'freeze-user', 'freeze-benchmark-v1', 'freeze-config', 'freeze-evaluation', 'byok', 'queued_evaluation', 1, 'environment-hash', 'harness-hash', 0, 0, 0, 0, 1, 1);",
    ],
    false,
  );
  assert.match(blockedLegacyCredentialInsert, /credential modes are sealed/i);

  const blockedLegacyCredentialUpdate = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE runs SET credential_mode = 'platform-credit' WHERE id = 'freeze-run';",
    ],
    false,
  );
  assert.match(blockedLegacyCredentialUpdate, /credential modes are sealed/i);

  const blockedLegacyStatusUpdate = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE runs SET status = 'generated' WHERE id = 'freeze-run';",
    ],
    false,
  );
  assert.match(blockedLegacyStatusUpdate, /generation run states are sealed/i);

  wrangler([
    "d1", "execute", "DB", "--command",
    "DROP TRIGGER runs_legacy_credential_no_insert; DROP TRIGGER runs_legacy_credential_no_update; DROP TRIGGER runs_legacy_credential_no_delete; INSERT INTO runs (id, public_slug, contributor_id, benchmark_version_id, configuration_id, evaluation_version_id, credential_mode, status, attempt_index, environment_hash, harness_contract_hash, overall_score_bps, rank_eligible, injection_flag, post_publication_marker, playable_enabled, failure_code, failure_summary, generated_at, created_at, updated_at) VALUES ('legacy-run-seal-probe', 'legacy-run-seal-probe', 'freeze-user', 'freeze-benchmark-v1', 'freeze-config', 'freeze-evaluation', 'byok', 'evaluating', 1, 'environment-hash', 'harness-hash', 6400, 1, 0, 0, 0, 'legacy-failure', 'legacy failure', 1, 1, 1); CREATE TRIGGER runs_legacy_credential_no_insert BEFORE INSERT ON runs WHEN NEW.credential_mode <> 'community-submission' BEGIN SELECT RAISE(ABORT, 'legacy run credential modes are sealed'); END;",
  ]);
  for (const statement of [
    "UPDATE runs SET overall_score_bps = 1 WHERE id = 'legacy-run-seal-probe';",
    "UPDATE runs SET rank_eligible = 0 WHERE id = 'legacy-run-seal-probe';",
    "UPDATE runs SET failure_code = 'tampered' WHERE id = 'legacy-run-seal-probe';",
    "UPDATE runs SET status = 'judging' WHERE id = 'legacy-run-seal-probe';",
  ]) {
    const blockedLegacyUpdate = wrangler(
      ["d1", "execute", "DB", "--command", statement], false,
    );
    assert.match(blockedLegacyUpdate, /legacy run fields are sealed/i);
  }
  const blockedLegacyDelete = wrangler(
    ["d1", "execute", "DB", "--command", "DELETE FROM runs WHERE id = 'legacy-run-seal-probe';"],
    false,
  );
  assert.match(blockedLegacyDelete, /legacy runs are preserved as a read-only archive/i);

  wrangler([
    "d1", "execute", "DB", "--command",
    "CREATE TRIGGER runs_legacy_credential_no_update BEFORE UPDATE ON runs WHEN OLD.credential_mode <> 'community-submission' OR NEW.credential_mode <> 'community-submission' BEGIN SELECT RAISE(ABORT, 'legacy run credential modes are sealed'); END; CREATE TRIGGER runs_legacy_credential_no_delete BEFORE DELETE ON runs WHEN OLD.credential_mode <> 'community-submission' BEGIN SELECT RAISE(ABORT, 'legacy runs are preserved as a read-only archive'); END;",
  ]);

  const blockedGenerationStageClaim = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--command",
      "INSERT INTO run_stage_claims (id, run_id, stage, stage_version, status, attempt_count, lease_expires_at, created_at, updated_at) VALUES ('generation-claim-probe', 'freeze-run', 'generate-platform', 'v1', 'claimed', 1, 2, 1, 1);",
    ],
    false,
  );
  assert.match(blockedGenerationStageClaim, /generation stage claims are sealed/i);
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
  assert.match(
    blockedRubricMutation,
    /published benchmark rubrics are immutable|rubric dimensions are frozen/i,
  );
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
    "INSERT INTO showcases (id, slug, owner_id, title, summary, category, model_label, harness, reasoning_level, prompt, source_visibility, rights_attested_at, status, safety_status, created_at, updated_at) VALUES ('quota-showcase', 'quota-showcase', 'freeze-user', 'Quota Showcase', 'Quota invariant fixture for upload session enforcement.', 'frontend', 'Example Model', 'Example Harness', 'high', 'Build a test.', 'private', 1, 'draft', 'pending', 1, 1);",
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
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name; SELECT name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check;",
  ]);
  const foreignKeyCheckOutput = wrangler(
    ["d1", "execute", "DB", "--command", "PRAGMA foreign_key_check;", "--json"],
  );
  assert.match(foreignKeyCheckOutput, /"results"\s*:\s*\[\]/);
  for (const trigger of [
    "audit_events_no_update",
    "audit_events_no_delete",
    "legacy_generation_funding_no_insert",
    "legacy_generation_funding_no_update",
    "legacy_generation_funding_no_delete",
    "generation_records_no_insert",
    "generation_records_no_update",
    "generation_records_no_delete",
    "run_artifacts_legacy_no_insert",
    "run_artifacts_legacy_no_update",
    "run_artifacts_legacy_no_delete",
    "judge_samples_legacy_no_insert",
    "judge_samples_legacy_no_update",
    "judge_samples_legacy_no_delete",
    "dimension_scores_legacy_no_insert",
    "dimension_scores_legacy_no_update",
    "dimension_scores_legacy_no_delete",
    "judge_samples_no_update",
    "objective_results_no_update",
    "moderation_actions_no_update",
    "benchmark_versions_frozen_after_run",
    "benchmark_versions_frozen_after_publish_update",
    "benchmark_versions_frozen_after_publish_delete",
    "evaluation_versions_frozen_after_run",
    "rubric_dimensions_frozen_after_run_update",
    "rubric_dimensions_frozen_after_run_delete",
    "rubric_dimensions_frozen_after_run_insert",
    "rubric_dimensions_frozen_after_publish_insert",
    "rubric_dimensions_frozen_after_publish_update",
    "rubric_dimensions_frozen_after_publish_delete",
    "harnesses_frozen_when_referenced",
    "providers_frozen_after_run",
    "model_versions_frozen_after_run",
    "models_frozen_after_run",
    "configurations_frozen_after_run",
    "benchmarks_frozen_after_run",
    "upload_sessions_kind_size_policy",
    "upload_sessions_submission_quota",
    "upload_sessions_account_quota",
    "runs_legacy_credential_no_insert",
    "runs_legacy_fields_no_update",
    "runs_legacy_credential_no_delete",
    "runs_legacy_status_no_insert",
    "runs_legacy_status_no_update",
    "run_stage_claims_legacy_generation_no_insert",
    "run_stage_claims_legacy_generation_no_update",
    "run_stage_claims_legacy_generation_no_delete",
    "result_spend_records_no_update",
    "result_spend_records_no_delete",
    "result_leaderboard_entries_sealed_no_insert",
    "result_leaderboard_entries_sealed_no_update",
    "result_leaderboard_entries_sealed_no_delete",
    "result_leaderboard_snapshots_sealed_identity_no_update",
    "result_leaderboard_snapshots_no_reopen",
    "result_leaderboard_snapshots_sealed_no_delete",
    "result_aggregate_entries_sealed_no_insert",
    "result_aggregate_entries_sealed_no_update",
    "result_aggregate_entries_sealed_no_delete",
    "result_aggregate_snapshots_sealed_identity_no_update",
    "result_aggregate_snapshots_no_reopen",
    "result_aggregate_snapshots_sealed_no_delete",
    "result_configurations_identity_frozen",
    "result_configurations_catalog_ids_frozen",
    "result_configurations_metadata_hash_frozen",
    "result_configurations_catalog_status_transition",
    "result_aggregate_snapshots",
    "result_aggregate_entries",
  ]) {
    assert.match(integrityOutput, new RegExp(trigger));
  }
  assert.match(integrityOutput, /legacy_generation_funding_history/);
  assert.doesNotMatch(integrityOutput, /credit_ledger/);

  console.log("D1 migrations, foreign keys, append-only records, and frozen contracts verified.");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
