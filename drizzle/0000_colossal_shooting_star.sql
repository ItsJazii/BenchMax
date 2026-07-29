CREATE TABLE `abuse_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`showcase_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "abuse_reports_details_length" CHECK(length("abuse_reports"."details") BETWEEN 10 AND 2000),
	CONSTRAINT "abuse_reports_reason_allowed" CHECK("abuse_reports"."reason" IN ('malware', 'copyright', 'fraud', 'harassment', 'other')),
	CONSTRAINT "abuse_reports_status_allowed" CHECK("abuse_reports"."status" IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `abuse_reports_status_idx` ON `abuse_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `abuse_reports_showcase_idx` ON `abuse_reports` (`showcase_id`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`showcase_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`quarantine_status` text DEFAULT 'awaiting-upload' NOT NULL,
	`scan_report_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "artifacts_size_positive" CHECK("artifacts"."byte_size" > 0),
	CONSTRAINT "artifacts_kind_allowed" CHECK("artifacts"."kind" IN ('source', 'video', 'image', 'log')),
	CONSTRAINT "artifacts_quarantine_status_allowed" CHECK("artifacts"."quarantine_status" IN ('awaiting-upload', 'quarantined', 'scanning', 'approved', 'blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_object_key_uidx` ON `artifacts` (`object_key`);--> statement-breakpoint
CREATE INDEX `artifacts_showcase_status_idx` ON `artifacts` (`showcase_id`,`quarantine_status`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `benchmark_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_id` text NOT NULL,
	`version` integer NOT NULL,
	`canonical_prompt` text NOT NULL,
	`rubric_json` text NOT NULL,
	`harness_contract_json` text NOT NULL,
	`environment_hash` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_id`) REFERENCES `benchmarks`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_versions_benchmark_version_uidx` ON `benchmark_versions` (`benchmark_id`,`version`);--> statement-breakpoint
CREATE INDEX `benchmark_versions_published_idx` ON `benchmark_versions` (`published_at`);--> statement-breakpoint
CREATE TABLE `benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "benchmarks_category_allowed" CHECK("benchmarks"."category" IN ('frontend', 'browser-game', 'browser-3d')),
	CONSTRAINT "benchmarks_status_allowed" CHECK("benchmarks"."status" IN ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmarks_slug_uidx` ON `benchmarks` (`slug`);--> statement-breakpoint
CREATE INDEX `benchmarks_category_status_idx` ON `benchmarks` (`category`,`status`);--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`version_label` text NOT NULL,
	`release_date` integer,
	`is_current` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_versions_model_label_uidx` ON `model_versions` (`model_id`,`version_label`);--> statement-breakpoint
CREATE INDEX `model_versions_model_idx` ON `model_versions` (`model_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "models_status_allowed" CHECK("models"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_slug_uidx` ON `models` (`slug`);--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider`);--> statement-breakpoint
CREATE TABLE `showcases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`model_version_id` text,
	`model_label` text NOT NULL,
	`harness` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`prompt` text NOT NULL,
	`system_prompt` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`safety_status` text DEFAULT 'pending' NOT NULL,
	`source_visibility` text DEFAULT 'public' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "showcases_title_length" CHECK(length("showcases"."title") BETWEEN 8 AND 120),
	CONSTRAINT "showcases_summary_length" CHECK(length("showcases"."summary") BETWEEN 24 AND 800),
	CONSTRAINT "showcases_category_allowed" CHECK("showcases"."category" IN ('frontend', 'browser-game', 'browser-3d', 'other')),
	CONSTRAINT "showcases_status_allowed" CHECK("showcases"."status" IN ('draft', 'published', 'rejected', 'removed')),
	CONSTRAINT "showcases_safety_status_allowed" CHECK("showcases"."safety_status" IN ('pending', 'scanning', 'approved', 'blocked')),
	CONSTRAINT "showcases_source_visibility_allowed" CHECK("showcases"."source_visibility" IN ('public', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showcases_slug_uidx` ON `showcases` (`slug`);--> statement-breakpoint
CREATE INDEX `showcases_public_feed_idx` ON `showcases` (`status`,`safety_status`,`published_at`);--> statement-breakpoint
CREATE INDEX `showcases_owner_idx` ON `showcases` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`showcase_id` text,
	`artifact_kind` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`expected_bytes` integer NOT NULL,
	`token_digest` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "upload_sessions_artifact_kind_allowed" CHECK("upload_sessions"."artifact_kind" IN ('source', 'video', 'image', 'log')),
	CONSTRAINT "upload_sessions_status_allowed" CHECK("upload_sessions"."status" IN ('created', 'uploading', 'uploaded', 'expired', 'cancelled')),
	CONSTRAINT "upload_sessions_expected_bytes_positive" CHECK("upload_sessions"."expected_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_sessions_object_key_uidx` ON `upload_sessions` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `upload_sessions_token_digest_uidx` ON `upload_sessions` (`token_digest`);--> statement-breakpoint
CREATE INDEX `upload_sessions_user_status_idx` ON `upload_sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `upload_sessions_expiry_idx` ON `upload_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'contributor' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_handle_length" CHECK(length("users"."handle") BETWEEN 3 AND 32),
	CONSTRAINT "users_role_allowed" CHECK("users"."role" IN ('owner', 'moderator', 'contributor')),
	CONSTRAINT "users_status_allowed" CHECK("users"."status" IN ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_uidx` ON `users` (`auth_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uidx` ON `users` (`handle`);