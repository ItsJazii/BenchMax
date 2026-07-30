DROP TRIGGER `benchmarks_frozen_after_run`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`goal` text,
	`success_criteria_json` text DEFAULT '[]' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`rubric_status` text DEFAULT 'drafting' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "benchmarks_category_allowed" CHECK("__new_benchmarks"."category" IN ('frontend', 'browser-game', 'browser-3d', 'other')),
	CONSTRAINT "benchmarks_status_allowed" CHECK("__new_benchmarks"."status" IN ('draft', 'active', 'retired')),
	CONSTRAINT "benchmarks_rubric_status_allowed" CHECK("__new_benchmarks"."rubric_status" IN ('drafting', 'awaiting_approval', 'approved'))
);
--> statement-breakpoint
INSERT INTO `__new_benchmarks`("id", "creator_id", "slug", "title", "goal", "success_criteria_json", "category", "status", "rubric_status", "created_at", "updated_at") SELECT "id", "creator_id", "slug", "title", "goal", "success_criteria_json", "category", "status", "rubric_status", "created_at", "updated_at" FROM `benchmarks`;--> statement-breakpoint
DROP TABLE `benchmarks`;--> statement-breakpoint
ALTER TABLE `__new_benchmarks` RENAME TO `benchmarks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `benchmarks_slug_uidx` ON `benchmarks` (`slug`);--> statement-breakpoint
CREATE INDEX `benchmarks_category_status_idx` ON `benchmarks` (`category`,`status`);--> statement-breakpoint
CREATE INDEX `benchmarks_creator_idx` ON `benchmarks` (`creator_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `benchmarks_frozen_after_run`
BEFORE UPDATE OF `slug`, `title`, `category` ON `benchmarks`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `benchmark_versions` ON `benchmark_versions`.`id` = `runs`.`benchmark_version_id`
  WHERE `benchmark_versions`.`benchmark_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'benchmark identity is frozen after its first run');
END;
