ALTER TABLE `benchmarks` ADD `creator_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `benchmarks` ADD `goal` text;--> statement-breakpoint
ALTER TABLE `benchmarks` ADD `success_criteria_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmarks` ADD `rubric_status` text DEFAULT 'approved' NOT NULL
  CHECK (`rubric_status` IN ('drafting', 'awaiting_approval', 'approved'));--> statement-breakpoint
CREATE INDEX `benchmarks_creator_idx` ON `benchmarks` (`creator_id`,`created_at`);--> statement-breakpoint

CREATE TABLE `catalog_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `requester_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE restrict,
  `kind` text NOT NULL CHECK (`kind` IN ('model', 'model-version', 'harness')),
  `requested_label` text NOT NULL,
  `normalized_label` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL
    CHECK (`status` IN ('pending', 'approved', 'mapped', 'rejected')),
  `mapped_entity_id` text,
  `reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `reviewed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `catalog_requests_status_idx` ON `catalog_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `catalog_requests_requester_idx` ON `catalog_requests` (`requester_user_id`,`created_at`);--> statement-breakpoint

CREATE TABLE `result_configurations` (
  `id` text PRIMARY KEY NOT NULL,
  `model_version_id` text REFERENCES `model_versions`(`id`) ON DELETE set null,
  `harness_id` text REFERENCES `harnesses`(`id`) ON DELETE set null,
  `model_label` text NOT NULL,
  `model_version_label` text NOT NULL,
  `harness_label` text NOT NULL,
  `reasoning_raw` text NOT NULL,
  `reasoning_normalized` text NOT NULL
    CHECK (`reasoning_normalized` IN ('none', 'low', 'medium', 'high', 'max', 'unknown')),
  `declared_settings_json` text DEFAULT '{}' NOT NULL,
  `metadata_hash` text NOT NULL,
  `catalog_status` text DEFAULT 'pending' NOT NULL
    CHECK (`catalog_status` IN ('canonical', 'pending')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `result_configurations_hash_uidx` ON `result_configurations` (`metadata_hash`);--> statement-breakpoint
CREATE INDEX `result_configurations_catalog_idx` ON `result_configurations` (`catalog_status`,`model_version_id`,`harness_id`);--> statement-breakpoint

ALTER TABLE `showcases` ADD `benchmark_version_id` text REFERENCES `benchmark_versions`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `showcases` ADD `result_configuration_id` text REFERENCES `result_configurations`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `showcases` ADD `judge_status` text DEFAULT 'not_queued' NOT NULL
  CHECK (`judge_status` IN ('not_queued', 'queued', 'evaluating', 'judging', 'scored', 'unranked', 'overdue', 'failed'));--> statement-breakpoint
ALTER TABLE `showcases` ADD `ranking_status` text DEFAULT 'pending' NOT NULL
  CHECK (`ranking_status` IN ('pending', 'eligible', 'catalog_pending', 'insufficient_evidence', 'moderation_hold', 'superseded', 'ineligible'));--> statement-breakpoint
ALTER TABLE `showcases` ADD `judge_due_at` integer;--> statement-breakpoint
ALTER TABLE `showcases` ADD `superseded_by_id` text;--> statement-breakpoint
CREATE INDEX `showcases_test_status_idx` ON `showcases` (`benchmark_version_id`,`status`,`judge_status`,`ranking_status`);--> statement-breakpoint

DROP TRIGGER `benchmark_versions_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `evaluation_versions_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `rubric_dimensions_frozen_after_run_update`;--> statement-breakpoint
DROP TRIGGER `rubric_dimensions_frozen_after_run_delete`;--> statement-breakpoint
DROP TRIGGER `rubric_dimensions_frozen_after_run_insert`;--> statement-breakpoint
DROP TRIGGER `providers_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `model_versions_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `models_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `configurations_frozen_after_run`;--> statement-breakpoint
DROP TRIGGER `benchmarks_frozen_after_run`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `public_slug` text NOT NULL,
  `contributor_id` text NOT NULL,
  `benchmark_version_id` text NOT NULL,
  `configuration_id` text NOT NULL,
  `evaluation_version_id` text NOT NULL,
  `credential_mode` text NOT NULL,
  `showcase_id` text,
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
  FOREIGN KEY (`contributor_id`) REFERENCES `users`(`id`) ON DELETE restrict,
  FOREIGN KEY (`benchmark_version_id`) REFERENCES `benchmark_versions`(`id`) ON DELETE restrict,
  FOREIGN KEY (`configuration_id`) REFERENCES `configurations`(`id`) ON DELETE restrict,
  FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON DELETE restrict,
  FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON DELETE set null,
  CONSTRAINT `runs_credential_mode_allowed` CHECK (`credential_mode` IN ('byok', 'platform-credit', 'community-submission')),
  CONSTRAINT `runs_status_allowed` CHECK (`status` IN ('draft', 'queued_generation', 'generating', 'generated', 'queued_evaluation', 'evaluating', 'judging', 'scored', 'published', 'generation_failed', 'evaluation_failed', 'disqualified')),
  CONSTRAINT `runs_attempt_positive` CHECK (`attempt_index` > 0),
  CONSTRAINT `runs_score_bounded` CHECK (`overall_score_bps` IS NULL OR `overall_score_bps` BETWEEN 0 AND 10000)
);--> statement-breakpoint
INSERT INTO `__new_runs`
  (`id`,`public_slug`,`contributor_id`,`benchmark_version_id`,`configuration_id`,`evaluation_version_id`,`credential_mode`,`showcase_id`,`status`,`attempt_index`,`pass_group_id`,`environment_hash`,`harness_contract_hash`,`overall_score_bps`,`rank_eligible`,`injection_flag`,`post_publication_marker`,`playable_enabled`,`output_content_hash`,`failure_code`,`failure_summary`,`generated_at`,`evaluated_at`,`scored_at`,`published_at`,`created_at`,`updated_at`)
SELECT
  `id`,`public_slug`,`contributor_id`,`benchmark_version_id`,`configuration_id`,`evaluation_version_id`,`credential_mode`,NULL,`status`,`attempt_index`,`pass_group_id`,`environment_hash`,`harness_contract_hash`,`overall_score_bps`,`rank_eligible`,`injection_flag`,`post_publication_marker`,`playable_enabled`,`output_content_hash`,`failure_code`,`failure_summary`,`generated_at`,`evaluated_at`,`scored_at`,`published_at`,`created_at`,`updated_at`
FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_public_slug_uidx` ON `runs` (`public_slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_showcase_uidx` ON `runs` (`showcase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_pass_attempt_uidx` ON `runs` (`pass_group_id`,`attempt_index`);--> statement-breakpoint
CREATE INDEX `runs_owner_status_idx` ON `runs` (`contributor_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_rank_idx` ON `runs` (`benchmark_version_id`,`configuration_id`,`status`,`rank_eligible`);--> statement-breakpoint
CREATE INDEX `runs_lifecycle_idx` ON `runs` (`status`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint

CREATE TRIGGER `benchmark_versions_frozen_after_run`
BEFORE UPDATE OF `canonical_prompt`, `rubric_json`, `harness_id`, `harness_contract_json`, `environment_hash`, `objective_weight_bps`, `judge_weight_bps`, `attempt_policy`, `attempt_count`, `dependency_lock_hash`, `interaction_script_hash`
ON `benchmark_versions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'benchmark version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `evaluation_versions_frozen_after_run`
BEFORE UPDATE OF `judge_provider`, `judge_model`, `judge_model_version`, `endpoint_origin`, `prompt_template`, `prompt_template_hash`, `rubric_protocol_version`, `sample_count`, `max_tokens_per_sample`, `calibration_set_hash`, `drift_threshold_bps`
ON `evaluation_versions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `evaluation_version_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'evaluation version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_update`
BEFORE UPDATE ON `rubric_dimensions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = OLD.`benchmark_version_id`)
BEGIN
  SELECT RAISE(ABORT, 'rubric dimensions are frozen after their benchmark version first runs');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_delete`
BEFORE DELETE ON `rubric_dimensions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = OLD.`benchmark_version_id`)
BEGIN
  SELECT RAISE(ABORT, 'rubric dimensions are frozen after their benchmark version first runs');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_insert`
BEFORE INSERT ON `rubric_dimensions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = NEW.`benchmark_version_id`)
BEGIN
  SELECT RAISE(ABORT, 'rubric dimensions are frozen after their benchmark version first runs');
END;--> statement-breakpoint
CREATE TRIGGER `providers_frozen_after_run`
BEFORE UPDATE OF `api_style`, `endpoint_origin` ON `providers`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `configurations` ON `configurations`.`id` = `runs`.`configuration_id`
  WHERE `configurations`.`provider_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'provider execution contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `model_versions_frozen_after_run`
BEFORE UPDATE OF `model_id`, `version_label`, `release_date`, `training_cutoff` ON `model_versions`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `configurations` ON `configurations`.`id` = `runs`.`configuration_id`
  WHERE `configurations`.`model_version_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'model version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `models_frozen_after_run`
BEFORE UPDATE OF `slug`, `name`, `provider`, `provider_id` ON `models`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `configurations` ON `configurations`.`id` = `runs`.`configuration_id`
  JOIN `model_versions` ON `model_versions`.`id` = `configurations`.`model_version_id`
  WHERE `model_versions`.`model_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'model identity is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `configurations_frozen_after_run`
BEFORE UPDATE OF `provider_id`, `model_version_id`, `harness_id`, `endpoint_name`, `provider_model_id`, `reasoning_level`, `sampling_settings_json`, `settings_hash`, `max_output_tokens`
ON `configurations`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `configuration_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'configuration contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `benchmarks_frozen_after_run`
BEFORE UPDATE OF `slug`, `title`, `category` ON `benchmarks`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `benchmark_versions` ON `benchmark_versions`.`id` = `runs`.`benchmark_version_id`
  WHERE `benchmark_versions`.`benchmark_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'benchmark identity is frozen after its first run');
END;--> statement-breakpoint

CREATE TRIGGER `catalog_requests_no_delete`
BEFORE DELETE ON `catalog_requests`
BEGIN
  SELECT RAISE(ABORT, 'catalog requests are append-preserved');
END;--> statement-breakpoint
CREATE TRIGGER `result_configurations_identity_frozen`
BEFORE UPDATE OF `model_label`,`model_version_label`,`harness_label`,`reasoning_raw`,`reasoning_normalized`,`declared_settings_json`,`metadata_hash`
ON `result_configurations`
BEGIN
  SELECT RAISE(ABORT, 'declared result metadata is immutable');
END;
