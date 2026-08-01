DROP TRIGGER IF EXISTS `result_configurations_identity_frozen`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_result_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`model_version_id` text,
	`harness_id` text,
	`model_label` text NOT NULL,
	`model_version_label` text NOT NULL,
	`harness_label` text NOT NULL,
	`reasoning_raw` text NOT NULL,
	`reasoning_normalized` text NOT NULL,
	`declared_settings_json` text DEFAULT '{}' NOT NULL,
	`metadata_hash` text NOT NULL,
	`catalog_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`harness_id`) REFERENCES `harnesses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "result_configurations_reasoning_allowed" CHECK("__new_result_configurations"."reasoning_normalized" IN ('none', 'low', 'medium', 'high', 'max', 'unknown')),
	CONSTRAINT "result_configurations_catalog_status_allowed" CHECK("__new_result_configurations"."catalog_status" IN ('canonical', 'pending', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_result_configurations`("id", "model_version_id", "harness_id", "model_label", "model_version_label", "harness_label", "reasoning_raw", "reasoning_normalized", "declared_settings_json", "metadata_hash", "catalog_status", "created_at", "updated_at") SELECT "id", "model_version_id", "harness_id", "model_label", "model_version_label", "harness_label", "reasoning_raw", "reasoning_normalized", "declared_settings_json", "metadata_hash", "catalog_status", "created_at", "updated_at" FROM `result_configurations`;--> statement-breakpoint
DROP TABLE `result_configurations`;--> statement-breakpoint
ALTER TABLE `__new_result_configurations` RENAME TO `result_configurations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `result_configurations_hash_uidx` ON `result_configurations` (`metadata_hash`);--> statement-breakpoint
CREATE INDEX `result_configurations_catalog_idx` ON `result_configurations` (`catalog_status`,`model_version_id`,`harness_id`);--> statement-breakpoint
CREATE TRIGGER `result_configurations_identity_frozen`
BEFORE UPDATE OF `model_label`,`model_version_label`,`harness_label`,`reasoning_raw`,`reasoning_normalized`,`declared_settings_json`,`metadata_hash`
ON `result_configurations`
BEGIN
  SELECT RAISE(ABORT, 'declared result metadata is immutable');
END;--> statement-breakpoint
ALTER TABLE `catalog_requests` ADD `result_configuration_id` text REFERENCES result_configurations(id);--> statement-breakpoint
CREATE INDEX `catalog_requests_configuration_idx` ON `catalog_requests` (`result_configuration_id`,`created_at`);
