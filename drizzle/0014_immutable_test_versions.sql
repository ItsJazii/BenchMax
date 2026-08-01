DROP TRIGGER `harnesses_frozen_when_referenced`;--> statement-breakpoint
DROP TRIGGER `benchmarks_frozen_after_run`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_benchmark_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`success_criteria_json` text NOT NULL,
	`category` text NOT NULL,
	`canonical_prompt` text NOT NULL,
	`rubric_json` text NOT NULL,
	`harness_id` text NOT NULL,
	`harness_contract_json` text NOT NULL,
	`environment_hash` text NOT NULL,
	`objective_weight_bps` integer DEFAULT 6000 NOT NULL,
	`judge_weight_bps` integer DEFAULT 4000 NOT NULL,
	`attempt_policy` text DEFAULT 'pass@1' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`dependency_lock_hash` text NOT NULL,
	`interaction_script_hash` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`benchmark_id`) REFERENCES `benchmarks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`harness_id`) REFERENCES `harnesses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "benchmark_versions_weights_total" CHECK("__new_benchmark_versions"."objective_weight_bps" + "__new_benchmark_versions"."judge_weight_bps" = 10000),
	CONSTRAINT "benchmark_versions_weights_bounded" CHECK("__new_benchmark_versions"."objective_weight_bps" BETWEEN 0 AND 10000 AND "__new_benchmark_versions"."judge_weight_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "benchmark_versions_attempt_policy_allowed" CHECK("__new_benchmark_versions"."attempt_policy" IN ('pass@1', 'pass@k')),
	CONSTRAINT "benchmark_versions_attempt_count_bounded" CHECK("__new_benchmark_versions"."attempt_count" BETWEEN 1 AND 10),
	CONSTRAINT "benchmark_versions_category_allowed" CHECK("__new_benchmark_versions"."category" IN ('frontend', 'browser-game', 'browser-3d', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_benchmark_versions`("id", "benchmark_id", "version", "title", "goal", "success_criteria_json", "category", "canonical_prompt", "rubric_json", "harness_id", "harness_contract_json", "environment_hash", "objective_weight_bps", "judge_weight_bps", "attempt_policy", "attempt_count", "dependency_lock_hash", "interaction_script_hash", "published_at", "created_at", "updated_at")
SELECT bv."id", bv."benchmark_id", bv."version", b."title", coalesce(b."goal", ''), b."success_criteria_json", b."category", bv."canonical_prompt", bv."rubric_json", bv."harness_id", bv."harness_contract_json", bv."environment_hash", bv."objective_weight_bps", bv."judge_weight_bps", bv."attempt_policy", bv."attempt_count", bv."dependency_lock_hash", bv."interaction_script_hash", bv."published_at", bv."created_at", bv."updated_at"
FROM `benchmark_versions` bv
JOIN `benchmarks` b ON b."id" = bv."benchmark_id";--> statement-breakpoint
DROP TABLE `benchmark_versions`;--> statement-breakpoint
ALTER TABLE `__new_benchmark_versions` RENAME TO `benchmark_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_versions_benchmark_version_uidx` ON `benchmark_versions` (`benchmark_id`,`version`);--> statement-breakpoint
CREATE INDEX `benchmark_versions_published_idx` ON `benchmark_versions` (`published_at`);--> statement-breakpoint
CREATE INDEX `benchmark_versions_harness_idx` ON `benchmark_versions` (`harness_id`);--> statement-breakpoint
CREATE TRIGGER `harnesses_frozen_when_referenced`
BEFORE UPDATE OF `loop_version`, `tools_json`, `file_policy_json`, `context_budget_tokens`, `turn_limit`, `dependency_policy_json`, `contract_hash`
ON `harnesses`
WHEN EXISTS (SELECT 1 FROM `benchmark_versions` WHERE `harness_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'referenced harness versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `benchmarks_frozen_after_run`
BEFORE UPDATE OF `slug`, `title`, `category` ON `benchmarks`
WHEN EXISTS (
  SELECT 1 FROM `runs`
  JOIN `benchmark_versions` ON `benchmark_versions`.`id` = `runs`.`benchmark_version_id`
  WHERE `benchmark_versions`.`benchmark_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'benchmark identity is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `benchmark_versions_frozen_after_run`
BEFORE UPDATE OF `title`, `goal`, `success_criteria_json`, `category`, `canonical_prompt`, `rubric_json`, `harness_id`, `harness_contract_json`, `environment_hash`, `objective_weight_bps`, `judge_weight_bps`, `attempt_policy`, `attempt_count`, `dependency_lock_hash`, `interaction_script_hash`
ON `benchmark_versions`
WHEN EXISTS (SELECT 1 FROM `runs` WHERE `benchmark_version_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'benchmark version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `benchmark_versions_frozen_after_publish_update`
BEFORE UPDATE ON `benchmark_versions`
WHEN OLD.`published_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'published benchmark versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `benchmark_versions_frozen_after_publish_delete`
BEFORE DELETE ON `benchmark_versions`
WHEN OLD.`published_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'published benchmark versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_publish_insert`
BEFORE INSERT ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1 FROM `benchmark_versions`
  WHERE `id` = NEW.`benchmark_version_id` AND `published_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published benchmark rubrics are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_publish_update`
BEFORE UPDATE ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1 FROM `benchmark_versions`
  WHERE (`id` = OLD.`benchmark_version_id` OR `id` = NEW.`benchmark_version_id`)
    AND `published_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published benchmark rubrics are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_publish_delete`
BEFORE DELETE ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1 FROM `benchmark_versions`
  WHERE `id` = OLD.`benchmark_version_id` AND `published_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'published benchmark rubrics are immutable');
END;
