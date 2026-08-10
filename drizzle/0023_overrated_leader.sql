CREATE TABLE `showcase_enrichment_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`enrichment_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`enrichment_id`) REFERENCES `showcase_enrichments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "showcase_enrichment_artifacts_kind_allowed" CHECK("showcase_enrichment_artifacts"."kind" IN ('screenshot', 'video', 'console', 'accessibility')),
	CONSTRAINT "showcase_enrichment_artifacts_size_positive" CHECK("showcase_enrichment_artifacts"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showcase_enrichment_artifacts_object_key_uidx` ON `showcase_enrichment_artifacts` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `showcase_enrichment_artifacts_kind_uidx` ON `showcase_enrichment_artifacts` (`enrichment_id`,`kind`);--> statement-breakpoint
CREATE INDEX `showcase_enrichment_artifacts_enrichment_idx` ON `showcase_enrichment_artifacts` (`enrichment_id`,`kind`);--> statement-breakpoint
CREATE TABLE `showcase_enrichment_spend_records` (
	`id` text PRIMARY KEY NOT NULL,
	`enrichment_id` text NOT NULL,
	`attempt_key` text NOT NULL,
	`status` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`cost_microusd` integer,
	`duration_ms` integer NOT NULL,
	`pricing_snapshot_json` text NOT NULL,
	`pricing_snapshot_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`enrichment_id`) REFERENCES `showcase_enrichments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "showcase_enrichment_spend_status_allowed" CHECK("showcase_enrichment_spend_records"."status" IN ('completed', 'failed')),
	CONSTRAINT "showcase_enrichment_spend_currency_usd" CHECK("showcase_enrichment_spend_records"."currency" = 'USD'),
	CONSTRAINT "showcase_enrichment_spend_cost_nonnegative" CHECK("showcase_enrichment_spend_records"."cost_microusd" IS NULL OR "showcase_enrichment_spend_records"."cost_microusd" >= 0),
	CONSTRAINT "showcase_enrichment_spend_duration_nonnegative" CHECK("showcase_enrichment_spend_records"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showcase_enrichment_spend_attempt_uidx` ON `showcase_enrichment_spend_records` (`attempt_key`);--> statement-breakpoint
CREATE INDEX `showcase_enrichment_spend_enrichment_idx` ON `showcase_enrichment_spend_records` (`enrichment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `showcase_enrichment_spend_daily_idx` ON `showcase_enrichment_spend_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `showcase_enrichments` (
	`id` text PRIMARY KEY NOT NULL,
	`showcase_id` text NOT NULL,
	`source_artifact_id` text NOT NULL,
	`source_sha256` text NOT NULL,
	`template_build_hash` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`failure_code` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "showcase_enrichments_status_allowed" CHECK("showcase_enrichments"."status" IN ('queued', 'running', 'completed', 'failed', 'not_applicable')),
	CONSTRAINT "showcase_enrichments_attempts_nonnegative" CHECK("showcase_enrichments"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showcase_enrichments_showcase_uidx` ON `showcase_enrichments` (`showcase_id`);--> statement-breakpoint
CREATE INDEX `showcase_enrichments_status_idx` ON `showcase_enrichments` (`status`,`updated_at`);