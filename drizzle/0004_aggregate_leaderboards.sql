CREATE TABLE `aggregate_leaderboard_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `evaluation_version_id` text NOT NULL,
  `version` integer NOT NULL,
  `run_set_hash` text NOT NULL,
  `status` text DEFAULT 'building' NOT NULL,
  `published_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT `aggregate_snapshots_scope_allowed` CHECK(`scope` IN ('frontend', 'browser-game', 'browser-3d', 'overall')),
  CONSTRAINT `aggregate_snapshots_status_allowed` CHECK(`status` IN ('building', 'published', 'superseded'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `aggregate_snapshots_scope_version_uidx` ON `aggregate_leaderboard_snapshots` (`scope`,`evaluation_version_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `aggregate_snapshots_scope_run_set_uidx` ON `aggregate_leaderboard_snapshots` (`scope`,`evaluation_version_id`,`run_set_hash`);--> statement-breakpoint
CREATE INDEX `aggregate_snapshots_public_idx` ON `aggregate_leaderboard_snapshots` (`scope`,`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `aggregate_leaderboard_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_id` text NOT NULL,
  `configuration_id` text NOT NULL,
  `rank` integer NOT NULL,
  `score_bps` integer NOT NULL,
  `benchmark_coverage` integer NOT NULL,
  `category_coverage` integer NOT NULL,
  `total_run_count` integer NOT NULL,
  `provisional` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `aggregate_leaderboard_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`configuration_id`) REFERENCES `configurations`(`id`) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT `aggregate_entries_rank_positive` CHECK(`rank` > 0),
  CONSTRAINT `aggregate_entries_score_bounded` CHECK(`score_bps` BETWEEN 0 AND 10000),
  CONSTRAINT `aggregate_entries_coverage_nonnegative` CHECK(`benchmark_coverage` >= 0 AND `category_coverage` >= 0 AND `total_run_count` > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `aggregate_entries_snapshot_config_uidx` ON `aggregate_leaderboard_entries` (`snapshot_id`,`configuration_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `aggregate_entries_snapshot_rank_uidx` ON `aggregate_leaderboard_entries` (`snapshot_id`,`rank`);
