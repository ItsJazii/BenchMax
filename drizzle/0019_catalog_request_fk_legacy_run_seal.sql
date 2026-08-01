PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_catalog_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`result_configuration_id` text,
	`requester_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`requested_label` text NOT NULL,
	`normalized_label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mapped_entity_id` text,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`result_configuration_id`) REFERENCES `result_configurations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "catalog_requests_kind_allowed" CHECK("__new_catalog_requests"."kind" IN ('model', 'model-version', 'harness')),
	CONSTRAINT "catalog_requests_status_allowed" CHECK("__new_catalog_requests"."status" IN ('pending', 'approved', 'mapped', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_catalog_requests`("id", "result_configuration_id", "requester_user_id", "kind", "requested_label", "normalized_label", "status", "mapped_entity_id", "reviewed_by_user_id", "reviewed_at", "created_at", "updated_at") SELECT "id", "result_configuration_id", "requester_user_id", "kind", "requested_label", "normalized_label", "status", "mapped_entity_id", "reviewed_by_user_id", "reviewed_at", "created_at", "updated_at" FROM `catalog_requests`;--> statement-breakpoint
DROP TABLE `catalog_requests`;--> statement-breakpoint
ALTER TABLE `__new_catalog_requests` RENAME TO `catalog_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `catalog_requests_status_idx` ON `catalog_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `catalog_requests_requester_idx` ON `catalog_requests` (`requester_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `catalog_requests_configuration_idx` ON `catalog_requests` (`result_configuration_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_fields_no_update`
BEFORE UPDATE OF `id`,`public_slug`,`contributor_id`,`benchmark_version_id`,`configuration_id`,`evaluation_version_id`,`showcase_id`,`status`,`attempt_index`,`pass_group_id`,`environment_hash`,`harness_contract_hash`,`overall_score_bps`,`rank_eligible`,`injection_flag`,`post_publication_marker`,`playable_enabled`,`output_content_hash`,`failure_code`,`failure_summary`,`generated_at`,`evaluated_at`,`scored_at`,`published_at`,`created_at`,`updated_at`
ON `runs`
WHEN OLD.`credential_mode` <> 'community-submission'
BEGIN
  SELECT RAISE(ABORT, 'legacy run fields are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_legacy_read_only_no_delete`
BEFORE DELETE ON `runs`
WHEN OLD.`credential_mode` <> 'community-submission'
BEGIN
  SELECT RAISE(ABORT, 'legacy runs are preserved as a read-only archive');
END;
