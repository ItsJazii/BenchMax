PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evaluation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`judge_provider` text NOT NULL,
	`judge_model` text NOT NULL,
	`judge_model_version` text NOT NULL,
	`endpoint_origin` text NOT NULL,
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
	CONSTRAINT "evaluation_versions_samples_three" CHECK("__new_evaluation_versions"."sample_count" = 3),
	CONSTRAINT "evaluation_versions_token_cap_positive" CHECK("__new_evaluation_versions"."max_tokens_per_sample" > 0),
	CONSTRAINT "evaluation_versions_drift_bounded" CHECK("__new_evaluation_versions"."drift_threshold_bps" BETWEEN 1 AND 10000),
	CONSTRAINT "evaluation_versions_status_allowed" CHECK("__new_evaluation_versions"."status" IN ('draft', 'candidate', 'active', 'frozen', 'retired'))
);
--> statement-breakpoint
INSERT INTO `__new_evaluation_versions`("id", "version", "judge_provider", "judge_model", "judge_model_version", "endpoint_origin", "prompt_template", "prompt_template_hash", "rubric_protocol_version", "sample_count", "max_tokens_per_sample", "calibration_set_hash", "drift_threshold_bps", "status", "created_at", "updated_at") SELECT "id", "version", "judge_provider", "judge_model", "judge_model_version", "endpoint_origin", "prompt_template", "prompt_template_hash", "rubric_protocol_version", "sample_count", "max_tokens_per_sample", "calibration_set_hash", "drift_threshold_bps", "status", "created_at", "updated_at" FROM `evaluation_versions`;--> statement-breakpoint
DROP TABLE `evaluation_versions`;--> statement-breakpoint
ALTER TABLE `__new_evaluation_versions` RENAME TO `evaluation_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_versions_version_uidx` ON `evaluation_versions` (`version`);--> statement-breakpoint
CREATE INDEX `evaluation_versions_prompt_hash_idx` ON `evaluation_versions` (`prompt_template_hash`,`rubric_protocol_version`);--> statement-breakpoint
CREATE TRIGGER `evaluation_versions_frozen_after_run`
BEFORE UPDATE OF `judge_provider`, `judge_model`, `judge_model_version`, `endpoint_origin`, `prompt_template`, `prompt_template_hash`, `rubric_protocol_version`, `sample_count`, `max_tokens_per_sample`, `calibration_set_hash`, `drift_threshold_bps`
ON `evaluation_versions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `evaluation_version_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'evaluation version contract is frozen after its first run');
END;