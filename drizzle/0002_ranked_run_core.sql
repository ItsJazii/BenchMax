CREATE TABLE `benchmark_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`proposer_user_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`specification_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`reviewed_by_user_id` text,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`proposer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "benchmark_proposals_category_allowed" CHECK("benchmark_proposals"."category" IN ('frontend', 'browser-game', 'browser-3d')),
	CONSTRAINT "benchmark_proposals_status_allowed" CHECK("benchmark_proposals"."status" IN ('draft', 'submitted', 'approved', 'rejected')),
	CONSTRAINT "benchmark_proposals_title_length" CHECK(length("benchmark_proposals"."title") BETWEEN 8 AND 120)
);
--> statement-breakpoint
CREATE INDEX `benchmark_proposals_status_idx` ON `benchmark_proposals` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_version_id` text NOT NULL,
	`harness_id` text NOT NULL,
	`endpoint_name` text NOT NULL,
	`provider_model_id` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`sampling_settings_json` text NOT NULL,
	`settings_hash` text NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`harness_id`) REFERENCES `harnesses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "configurations_reasoning_allowed" CHECK("configurations"."reasoning_level" IN ('low', 'medium', 'high', 'max')),
	CONSTRAINT "configurations_output_tokens_bounded" CHECK("configurations"."max_output_tokens" BETWEEN 1 AND 200000),
	CONSTRAINT "configurations_status_allowed" CHECK("configurations"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configurations_exact_uidx` ON `configurations` (`provider_id`,`model_version_id`,`harness_id`,`endpoint_name`,`reasoning_level`,`settings_hash`);--> statement-breakpoint
CREATE INDEX `configurations_model_idx` ON `configurations` (`model_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`amount_milli_credits` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_ledger_type_allowed" CHECK("credit_ledger"."type" IN ('admin-grant', 'reserve', 'generation-charge', 'judge-charge', 'sandbox-charge', 'refund', 'adjustment')),
	CONSTRAINT "credit_ledger_amount_nonzero" CHECK("credit_ledger"."amount_milli_credits" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_uidx` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_user_idx` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_ledger_run_idx` ON `credit_ledger` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dimension_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`rubric_dimension_id` text NOT NULL,
	`objective_score_bps` integer,
	`judge_median_score_bps` integer,
	`original_combined_score_bps` integer NOT NULL,
	`adjusted_combined_score_bps` integer,
	`override_action_id` text,
	`reasoning` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rubric_dimension_id`) REFERENCES `rubric_dimensions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dimension_scores_original_bounded" CHECK("dimension_scores"."original_combined_score_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "dimension_scores_adjusted_bounded" CHECK("dimension_scores"."adjusted_combined_score_bps" IS NULL OR "dimension_scores"."adjusted_combined_score_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dimension_scores_run_dimension_uidx` ON `dimension_scores` (`run_id`,`rubric_dimension_id`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`opened_by_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opened_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "disputes_status_allowed" CHECK("disputes"."status" IN ('open', 'reviewing', 'resolved', 'dismissed')),
	CONSTRAINT "disputes_reason_length" CHECK(length("disputes"."reason") BETWEEN 20 AND 4000)
);
--> statement-breakpoint
CREATE INDEX `disputes_status_idx` ON `disputes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `disputes_run_idx` ON `disputes` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `evaluation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`judge_provider` text NOT NULL,
	`judge_model` text NOT NULL,
	`judge_model_version` text NOT NULL,
	`prompt_template` text NOT NULL,
	`prompt_template_hash` text NOT NULL,
	`rubric_protocol_version` text NOT NULL,
	`sample_count` integer DEFAULT 3 NOT NULL,
	`max_tokens_per_sample` integer NOT NULL,
	`calibration_set_hash` text NOT NULL,
	`drift_threshold_bps` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "evaluation_versions_samples_three" CHECK("evaluation_versions"."sample_count" = 3),
	CONSTRAINT "evaluation_versions_token_cap_positive" CHECK("evaluation_versions"."max_tokens_per_sample" > 0),
	CONSTRAINT "evaluation_versions_drift_bounded" CHECK("evaluation_versions"."drift_threshold_bps" BETWEEN 1 AND 10000),
	CONSTRAINT "evaluation_versions_status_allowed" CHECK("evaluation_versions"."status" IN ('draft', 'active', 'frozen', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_versions_version_uidx` ON `evaluation_versions` (`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_versions_prompt_hash_uidx` ON `evaluation_versions` (`prompt_template_hash`,`rubric_protocol_version`);--> statement-breakpoint
CREATE TABLE `generation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_hash` text NOT NULL,
	`provenance_hash` text NOT NULL,
	`encrypted_envelope_object_key` text NOT NULL,
	`encrypted_envelope_sha256` text NOT NULL,
	`redacted_transcript` text NOT NULL,
	`provider_request_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer NOT NULL,
	`harness_turn_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generation_records_duration_nonnegative" CHECK("generation_records"."duration_ms" >= 0),
	CONSTRAINT "generation_records_turns_positive" CHECK("generation_records"."harness_turn_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_records_run_uidx` ON `generation_records` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_records_provenance_uidx` ON `generation_records` (`provenance_hash`);--> statement-breakpoint
CREATE TABLE `harnesses` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`loop_version` text NOT NULL,
	`tools_json` text NOT NULL,
	`file_policy_json` text NOT NULL,
	`context_budget_tokens` integer NOT NULL,
	`turn_limit` integer NOT NULL,
	`dependency_policy_json` text NOT NULL,
	`contract_hash` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "harnesses_version_positive" CHECK("harnesses"."version" > 0),
	CONSTRAINT "harnesses_context_budget_positive" CHECK("harnesses"."context_budget_tokens" > 0),
	CONSTRAINT "harnesses_turn_limit_bounded" CHECK("harnesses"."turn_limit" BETWEEN 1 AND 100),
	CONSTRAINT "harnesses_status_allowed" CHECK("harnesses"."status" IN ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harnesses_slug_version_uidx` ON `harnesses` (`slug`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `harnesses_contract_hash_uidx` ON `harnesses` (`contract_hash`);--> statement-breakpoint
CREATE TABLE `judge_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`evaluation_version_id` text NOT NULL,
	`sample_index` integer NOT NULL,
	`structured_output_json` text NOT NULL,
	`response_hash` text NOT NULL,
	`injection_flag` integer DEFAULT false NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "judge_samples_index_three" CHECK("judge_samples"."sample_index" BETWEEN 1 AND 3),
	CONSTRAINT "judge_samples_duration_nonnegative" CHECK("judge_samples"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `judge_samples_run_index_uidx` ON `judge_samples` (`run_id`,`evaluation_version_id`,`sample_index`);--> statement-breakpoint
CREATE TABLE `leaderboard_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`configuration_id` text NOT NULL,
	`rank` integer NOT NULL,
	`median_score_bps` integer NOT NULL,
	`q1_score_bps` integer NOT NULL,
	`q3_score_bps` integer NOT NULL,
	`run_count` integer NOT NULL,
	`provisional` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `leaderboard_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configuration_id`) REFERENCES `configurations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "leaderboard_entries_rank_positive" CHECK("leaderboard_entries"."rank" > 0),
	CONSTRAINT "leaderboard_entries_scores_bounded" CHECK("leaderboard_entries"."median_score_bps" BETWEEN 0 AND 10000 AND "leaderboard_entries"."q1_score_bps" BETWEEN 0 AND 10000 AND "leaderboard_entries"."q3_score_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "leaderboard_entries_quartile_order" CHECK("leaderboard_entries"."q1_score_bps" <= "leaderboard_entries"."median_score_bps" AND "leaderboard_entries"."median_score_bps" <= "leaderboard_entries"."q3_score_bps"),
	CONSTRAINT "leaderboard_entries_run_count_positive" CHECK("leaderboard_entries"."run_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_entries_snapshot_config_uidx` ON `leaderboard_entries` (`snapshot_id`,`configuration_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_entries_snapshot_rank_uidx` ON `leaderboard_entries` (`snapshot_id`,`rank`);--> statement-breakpoint
CREATE TABLE `leaderboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_version_id` text NOT NULL,
	`evaluation_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`run_set_hash` text NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_version_id`) REFERENCES `benchmark_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "leaderboard_snapshots_status_allowed" CHECK("leaderboard_snapshots"."status" IN ('building', 'published', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_snapshots_version_uidx` ON `leaderboard_snapshots` (`benchmark_version_id`,`evaluation_version_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_snapshots_run_set_uidx` ON `leaderboard_snapshots` (`benchmark_version_id`,`evaluation_version_id`,`run_set_hash`);--> statement-breakpoint
CREATE INDEX `leaderboard_snapshots_public_idx` ON `leaderboard_snapshots` (`benchmark_version_id`,`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`previous_state_json` text NOT NULL,
	`next_state_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "moderation_actions_entity_allowed" CHECK("moderation_actions"."entity_type" IN ('showcase', 'run', 'abuse-report', 'dispute')),
	CONSTRAINT "moderation_actions_action_allowed" CHECK("moderation_actions"."action" IN ('flag', 'unpublish', 'restore', 'disqualify', 'resolve', 'dismiss', 'score-override')),
	CONSTRAINT "moderation_actions_reason_length" CHECK(length("moderation_actions"."reason") BETWEEN 10 AND 2000)
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_entity_idx` ON `moderation_actions` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `objective_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`check_key` text NOT NULL,
	`status` text NOT NULL,
	`score_bps` integer NOT NULL,
	`metric_value_json` text NOT NULL,
	`evidence_artifact_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_artifact_id`) REFERENCES `run_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "objective_results_status_allowed" CHECK("objective_results"."status" IN ('pass', 'fail', 'error')),
	CONSTRAINT "objective_results_score_bounded" CHECK("objective_results"."score_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objective_results_run_check_uidx` ON `objective_results` (`run_id`,`check_key`);--> statement-breakpoint
CREATE INDEX `objective_results_run_dimension_idx` ON `objective_results` (`run_id`,`dimension_key`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`api_style` text NOT NULL,
	`endpoint_origin` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "providers_api_style_allowed" CHECK("providers"."api_style" IN ('openai-compatible', 'anthropic-compatible')),
	CONSTRAINT "providers_status_allowed" CHECK("providers"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_uidx` ON `providers` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `providers_origin_uidx` ON `providers` (`endpoint_origin`);--> statement-breakpoint
CREATE TABLE `rubric_dimensions` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_version_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`mechanism` text NOT NULL,
	`weight_bps` integer NOT NULL,
	`judge_source_required` integer DEFAULT false NOT NULL,
	`ordinal` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_version_id`) REFERENCES `benchmark_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rubric_dimensions_mechanism_allowed" CHECK("rubric_dimensions"."mechanism" IN ('objective', 'judge', 'hybrid')),
	CONSTRAINT "rubric_dimensions_weight_bounded" CHECK("rubric_dimensions"."weight_bps" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_dimensions_version_key_uidx` ON `rubric_dimensions` (`benchmark_version_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_dimensions_version_ordinal_uidx` ON `rubric_dimensions` (`benchmark_version_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "run_artifacts_size_positive" CHECK("run_artifacts"."byte_size" > 0),
	CONSTRAINT "run_artifacts_kind_allowed" CHECK("run_artifacts"."kind" IN ('generated-source', 'build-log', 'run-log', 'screenshot', 'video', 'bundle', 'evaluation-report'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_artifacts_object_key_uidx` ON `run_artifacts` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_artifacts_run_kind_hash_uidx` ON `run_artifacts` (`run_id`,`kind`,`sha256`);--> statement-breakpoint
CREATE INDEX `run_artifacts_run_idx` ON `run_artifacts` (`run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `run_stage_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`stage_version` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`completed_at` integer,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "run_stage_claims_stage_allowed" CHECK("run_stage_claims"."stage" IN ('generate-platform', 'evaluate', 'judge', 'publish')),
	CONSTRAINT "run_stage_claims_status_allowed" CHECK("run_stage_claims"."status" IN ('claimed', 'completed', 'failed')),
	CONSTRAINT "run_stage_claims_attempts_positive" CHECK("run_stage_claims"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_stage_claims_idempotency_uidx` ON `run_stage_claims` (`run_id`,`stage`,`stage_version`);--> statement-breakpoint
CREATE INDEX `run_stage_claims_lease_idx` ON `run_stage_claims` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`public_slug` text NOT NULL,
	`contributor_id` text NOT NULL,
	`benchmark_version_id` text NOT NULL,
	`configuration_id` text NOT NULL,
	`evaluation_version_id` text NOT NULL,
	`credential_mode` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`attempt_index` integer DEFAULT 1 NOT NULL,
	`pass_group_id` text,
	`environment_hash` text NOT NULL,
	`harness_contract_hash` text NOT NULL,
	`overall_score_bps` integer,
	`rank_eligible` integer DEFAULT false NOT NULL,
	`injection_flag` integer DEFAULT false NOT NULL,
	`post_publication_marker` integer DEFAULT false NOT NULL,
	`playable_enabled` integer DEFAULT false NOT NULL,
	`output_content_hash` text,
	`failure_code` text,
	`failure_summary` text,
	`generated_at` integer,
	`evaluated_at` integer,
	`scored_at` integer,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`benchmark_version_id`) REFERENCES `benchmark_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`configuration_id`) REFERENCES `configurations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "runs_credential_mode_allowed" CHECK("runs"."credential_mode" IN ('byok', 'platform-credit')),
	CONSTRAINT "runs_status_allowed" CHECK("runs"."status" IN ('draft', 'queued_generation', 'generating', 'generated', 'queued_evaluation', 'evaluating', 'judging', 'scored', 'published', 'generation_failed', 'evaluation_failed', 'disqualified')),
	CONSTRAINT "runs_attempt_positive" CHECK("runs"."attempt_index" > 0),
	CONSTRAINT "runs_score_bounded" CHECK("runs"."overall_score_bps" IS NULL OR "runs"."overall_score_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_public_slug_uidx` ON `runs` (`public_slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_pass_attempt_uidx` ON `runs` (`pass_group_id`,`attempt_index`);--> statement-breakpoint
CREATE INDEX `runs_owner_status_idx` ON `runs` (`contributor_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_rank_idx` ON `runs` (`benchmark_version_id`,`configuration_id`,`status`,`rank_eligible`);--> statement-breakpoint
CREATE INDEX `runs_lifecycle_idx` ON `runs` (`status`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
INSERT INTO `providers` (`id`, `slug`, `name`, `api_style`, `endpoint_origin`, `status`, `created_at`, `updated_at`)
SELECT 'legacy:' || lower(hex(`provider`)), 'legacy-' || lower(hex(`provider`)), `provider`, 'openai-compatible', 'https://disabled.invalid/' || lower(hex(`provider`)), 'disabled', min(`created_at`), max(`updated_at`)
FROM `models`
GROUP BY `provider`;--> statement-breakpoint
CREATE TABLE `__new_models` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "models_status_allowed" CHECK("__new_models"."status" IN ('active', 'archived'))
);--> statement-breakpoint
INSERT INTO `__new_models` (`id`, `slug`, `name`, `provider`, `provider_id`, `status`, `created_at`, `updated_at`)
SELECT `id`, `slug`, `name`, `provider`, 'legacy:' || lower(hex(`provider`)), `status`, `created_at`, `updated_at`
FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
CREATE UNIQUE INDEX `models_slug_uidx` ON `models` (`slug`);--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
INSERT INTO `harnesses` (`id`, `slug`, `name`, `version`, `loop_version`, `tools_json`, `file_policy_json`, `context_budget_tokens`, `turn_limit`, `dependency_policy_json`, `contract_hash`, `status`, `created_at`, `updated_at`)
SELECT 'legacy-harness:' || `id`, 'legacy-' || lower(hex(`id`)), 'Legacy imported harness', 1, 'legacy-unversioned', '[]', '{}', 1, 1, '{}', 'legacy:' || `id`, 'retired', `created_at`, `updated_at`
FROM `benchmark_versions`;--> statement-breakpoint
CREATE TABLE `__new_benchmark_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_id` text NOT NULL,
	`version` integer NOT NULL,
	`canonical_prompt` text NOT NULL,
	`rubric_json` text NOT NULL,
	`harness_id` text NOT NULL,
	`harness_contract_json` text NOT NULL,
	`environment_hash` text NOT NULL,
	`objective_weight_bps` integer DEFAULT 6000 NOT NULL,
	`judge_weight_bps` integer DEFAULT 4000 NOT NULL,
	`attempt_policy` text DEFAULT 'pass@1' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`dependency_lock_hash` text NOT NULL,
	`interaction_script_hash` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_id`) REFERENCES `benchmarks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`harness_id`) REFERENCES `harnesses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "benchmark_versions_weights_total" CHECK("__new_benchmark_versions"."objective_weight_bps" + "__new_benchmark_versions"."judge_weight_bps" = 10000),
	CONSTRAINT "benchmark_versions_weights_bounded" CHECK("__new_benchmark_versions"."objective_weight_bps" BETWEEN 0 AND 10000 AND "__new_benchmark_versions"."judge_weight_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "benchmark_versions_attempt_policy_allowed" CHECK("__new_benchmark_versions"."attempt_policy" IN ('pass@1', 'pass@k')),
	CONSTRAINT "benchmark_versions_attempt_count_bounded" CHECK("__new_benchmark_versions"."attempt_count" BETWEEN 1 AND 10)
);
--> statement-breakpoint
INSERT INTO `__new_benchmark_versions`("id", "benchmark_id", "version", "canonical_prompt", "rubric_json", "harness_id", "harness_contract_json", "environment_hash", "objective_weight_bps", "judge_weight_bps", "attempt_policy", "attempt_count", "dependency_lock_hash", "interaction_script_hash", "published_at", "created_at", "updated_at")
SELECT "id", "benchmark_id", "version", "canonical_prompt", "rubric_json", 'legacy-harness:' || "id", "harness_contract_json", "environment_hash", 6000, 4000, 'pass@1', 1, 'legacy:missing', 'legacy:missing', "published_at", "created_at", "updated_at"
FROM `benchmark_versions`;--> statement-breakpoint
DROP TABLE `benchmark_versions`;--> statement-breakpoint
ALTER TABLE `__new_benchmark_versions` RENAME TO `benchmark_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_versions_benchmark_version_uidx` ON `benchmark_versions` (`benchmark_id`,`version`);--> statement-breakpoint
CREATE INDEX `benchmark_versions_published_idx` ON `benchmark_versions` (`published_at`);--> statement-breakpoint
CREATE INDEX `benchmark_versions_harness_idx` ON `benchmark_versions` (`harness_id`);--> statement-breakpoint
ALTER TABLE `model_versions` ADD `training_cutoff` integer;
--> statement-breakpoint
CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_no_update`
BEFORE UPDATE ON `credit_ledger`
BEGIN
	SELECT RAISE(ABORT, 'credit ledger is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_no_delete`
BEFORE DELETE ON `credit_ledger`
BEGIN
	SELECT RAISE(ABORT, 'credit ledger is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `generation_records_no_update`
BEFORE UPDATE ON `generation_records`
BEGIN
	SELECT RAISE(ABORT, 'generation records are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `generation_records_no_delete`
BEFORE DELETE ON `generation_records`
BEGIN
	SELECT RAISE(ABORT, 'generation records are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `judge_samples_no_update`
BEFORE UPDATE ON `judge_samples`
BEGIN
	SELECT RAISE(ABORT, 'judge samples are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `judge_samples_no_delete`
BEFORE DELETE ON `judge_samples`
BEGIN
	SELECT RAISE(ABORT, 'judge samples are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `objective_results_no_update`
BEFORE UPDATE ON `objective_results`
BEGIN
	SELECT RAISE(ABORT, 'objective results are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `objective_results_no_delete`
BEFORE DELETE ON `objective_results`
BEGIN
	SELECT RAISE(ABORT, 'objective results are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `moderation_actions_no_update`
BEFORE UPDATE ON `moderation_actions`
BEGIN
	SELECT RAISE(ABORT, 'moderation actions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `moderation_actions_no_delete`
BEFORE DELETE ON `moderation_actions`
BEGIN
	SELECT RAISE(ABORT, 'moderation actions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `benchmark_versions_frozen_after_run`
BEFORE UPDATE OF `canonical_prompt`, `rubric_json`, `harness_id`, `harness_contract_json`, `environment_hash`, `objective_weight_bps`, `judge_weight_bps`, `attempt_policy`, `attempt_count`, `dependency_lock_hash`, `interaction_script_hash`
ON `benchmark_versions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'benchmark version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `harnesses_frozen_when_referenced`
BEFORE UPDATE OF `loop_version`, `tools_json`, `file_policy_json`, `context_budget_tokens`, `turn_limit`, `dependency_policy_json`, `contract_hash`
ON `harnesses`
WHEN EXISTS (SELECT 1 FROM `benchmark_versions` WHERE `harness_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'referenced harness versions are immutable');
END;
