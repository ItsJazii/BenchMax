CREATE TABLE `legacy_generation_funding_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`amount_milli_units` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "legacy_generation_funding_type_allowed" CHECK("legacy_generation_funding_history"."type" IN ('admin-grant', 'reserve', 'generation-charge', 'judge-charge', 'sandbox-charge', 'refund', 'adjustment')),
	CONSTRAINT "legacy_generation_funding_amount_nonzero" CHECK("legacy_generation_funding_history"."amount_milli_units" <> 0)
);
--> statement-breakpoint
INSERT INTO `legacy_generation_funding_history` (
	`id`,
	`user_id`,
	`run_id`,
	`type`,
	`amount_milli_units`,
	`idempotency_key`,
	`metadata_json`,
	`actor_user_id`,
	`created_at`
)
SELECT
	`id`,
	`user_id`,
	`run_id`,
	`type`,
	`amount_milli_credits`,
	`idempotency_key`,
	`metadata_json`,
	`actor_user_id`,
	`created_at`
FROM `credit_ledger`;
--> statement-breakpoint
DROP TABLE `credit_ledger`;
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_generation_funding_idempotency_uidx` ON `legacy_generation_funding_history` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `legacy_generation_funding_user_idx` ON `legacy_generation_funding_history` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `legacy_generation_funding_run_idx` ON `legacy_generation_funding_history` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `legacy_generation_funding_no_insert`
BEFORE INSERT ON `legacy_generation_funding_history`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation funding history is sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_generation_funding_no_update`
BEFORE UPDATE ON `legacy_generation_funding_history`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation funding history is sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_generation_funding_no_delete`
BEFORE DELETE ON `legacy_generation_funding_history`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation funding history is sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `generation_records_no_insert`
BEFORE INSERT ON `generation_records`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation records are sealed');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `generation_records_no_update`;--> statement-breakpoint
CREATE TRIGGER `generation_records_no_update`
BEFORE UPDATE ON `generation_records`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation records are sealed');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `generation_records_no_delete`;--> statement-breakpoint
CREATE TRIGGER `generation_records_no_delete`
BEFORE DELETE ON `generation_records`
BEGIN
  SELECT RAISE(ABORT, 'legacy generation records are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_artifacts_legacy_no_insert`
BEFORE INSERT ON `run_artifacts`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy run artifacts are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_artifacts_legacy_no_update`
BEFORE UPDATE ON `run_artifacts`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
OR EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy run artifacts are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_artifacts_legacy_no_delete`
BEFORE DELETE ON `run_artifacts`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy run artifacts are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `judge_samples_legacy_no_insert`
BEFORE INSERT ON `judge_samples`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy judge samples are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `judge_samples_legacy_no_update`
BEFORE UPDATE ON `judge_samples`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
OR EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy judge samples are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `judge_samples_legacy_no_delete`
BEFORE DELETE ON `judge_samples`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy judge samples are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `dimension_scores_legacy_no_insert`
BEFORE INSERT ON `dimension_scores`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy dimension scores are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `dimension_scores_legacy_no_update`
BEFORE UPDATE ON `dimension_scores`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
OR EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = NEW.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy dimension scores are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `dimension_scores_legacy_no_delete`
BEFORE DELETE ON `dimension_scores`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  WHERE `runs`.`id` = OLD.`run_id`
    AND `runs`.`credential_mode` <> 'community-submission'
)
BEGIN
  SELECT RAISE(ABORT, 'legacy dimension scores are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_credential_no_insert`
BEFORE INSERT ON `runs`
WHEN NEW.`credential_mode` <> 'community-submission'
BEGIN
  SELECT RAISE(ABORT, 'legacy run credential modes are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_credential_no_update`
BEFORE UPDATE ON `runs`
WHEN OLD.`credential_mode` <> 'community-submission'
  OR NEW.`credential_mode` <> 'community-submission'
BEGIN
  SELECT RAISE(ABORT, 'legacy run credential modes are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_credential_no_delete`
BEFORE DELETE ON `runs`
WHEN OLD.`credential_mode` <> 'community-submission'
BEGIN
  SELECT RAISE(ABORT, 'legacy runs are preserved as a read-only archive');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_status_no_insert`
BEFORE INSERT ON `runs`
WHEN NEW.`status` IN ('draft', 'queued_generation', 'generating', 'generated', 'generation_failed')
BEGIN
  SELECT RAISE(ABORT, 'legacy generation run states are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_status_no_update`
BEFORE UPDATE ON `runs`
WHEN NEW.`status` IN ('draft', 'queued_generation', 'generating', 'generated', 'generation_failed')
BEGIN
  SELECT RAISE(ABORT, 'legacy generation run states are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_stage_claims_legacy_generation_no_insert`
BEFORE INSERT ON `run_stage_claims`
WHEN NEW.`stage` = 'generate-platform'
BEGIN
  SELECT RAISE(ABORT, 'legacy generation stage claims are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_stage_claims_legacy_generation_no_update`
BEFORE UPDATE ON `run_stage_claims`
WHEN OLD.`stage` = 'generate-platform' OR NEW.`stage` = 'generate-platform'
BEGIN
  SELECT RAISE(ABORT, 'legacy generation stage claims are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_stage_claims_legacy_generation_no_delete`
BEFORE DELETE ON `run_stage_claims`
WHEN OLD.`stage` = 'generate-platform'
BEGIN
  SELECT RAISE(ABORT, 'legacy generation stage claims are sealed');
END;
