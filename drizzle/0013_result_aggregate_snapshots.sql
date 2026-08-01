CREATE TABLE `result_aggregate_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`result_configuration_id` text NOT NULL,
	`score_bps` integer NOT NULL,
	`q1_score_bps` integer NOT NULL,
	`q3_score_bps` integer NOT NULL,
	`test_coverage` integer NOT NULL,
	`contributor_count` integer NOT NULL,
	`provisional` integer NOT NULL,
	`source_snapshot_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `result_aggregate_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_configuration_id`) REFERENCES `result_configurations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "result_aggregate_entries_score_bounded" CHECK("result_aggregate_entries"."score_bps" BETWEEN 0 AND 10000 AND "result_aggregate_entries"."q1_score_bps" BETWEEN 0 AND 10000 AND "result_aggregate_entries"."q3_score_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "result_aggregate_entries_quartile_order" CHECK("result_aggregate_entries"."q1_score_bps" <= "result_aggregate_entries"."q3_score_bps"),
	CONSTRAINT "result_aggregate_entries_coverage_positive" CHECK("result_aggregate_entries"."test_coverage" > 0 AND "result_aggregate_entries"."contributor_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_aggregate_entries_snapshot_config_uidx` ON `result_aggregate_entries` (`snapshot_id`,`result_configuration_id`);--> statement-breakpoint
CREATE INDEX `result_aggregate_entries_score_idx` ON `result_aggregate_entries` (`snapshot_id`,`score_bps`);--> statement-breakpoint
CREATE TABLE `result_aggregate_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`source_set_hash` text NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "result_aggregate_snapshots_status_allowed" CHECK("result_aggregate_snapshots"."status" IN ('building', 'published', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_aggregate_snapshots_version_uidx` ON `result_aggregate_snapshots` (`evaluation_version_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `result_aggregate_snapshots_set_uidx` ON `result_aggregate_snapshots` (`evaluation_version_id`,`source_set_hash`);--> statement-breakpoint
CREATE INDEX `result_aggregate_snapshots_public_idx` ON `result_aggregate_snapshots` (`evaluation_version_id`,`status`,`published_at`);