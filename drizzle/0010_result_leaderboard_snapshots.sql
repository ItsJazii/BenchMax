CREATE TABLE `result_leaderboard_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`showcase_id` text NOT NULL,
	`run_id` text NOT NULL,
	`rank` integer NOT NULL,
	`score_bps` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `result_leaderboard_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "result_entries_rank_positive" CHECK("result_leaderboard_entries"."rank" > 0),
	CONSTRAINT "result_entries_score_bounded" CHECK("result_leaderboard_entries"."score_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "result_entries_sample_count_allowed" CHECK("result_leaderboard_entries"."sample_count" IN (1, 3))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_entries_snapshot_showcase_uidx` ON `result_leaderboard_entries` (`snapshot_id`,`showcase_id`);--> statement-breakpoint
CREATE INDEX `result_entries_rank_idx` ON `result_leaderboard_entries` (`snapshot_id`,`rank`);--> statement-breakpoint
CREATE TABLE `result_leaderboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_version_id` text NOT NULL,
	`evaluation_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`result_set_hash` text NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_version_id`) REFERENCES `benchmark_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_snapshots_version_uidx` ON `result_leaderboard_snapshots` (`benchmark_version_id`,`evaluation_version_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `result_snapshots_set_uidx` ON `result_leaderboard_snapshots` (`benchmark_version_id`,`evaluation_version_id`,`result_set_hash`);--> statement-breakpoint
CREATE INDEX `result_snapshots_public_idx` ON `result_leaderboard_snapshots` (`benchmark_version_id`,`status`,`published_at`);