CREATE TABLE `judge_budget_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`contributor_id` text NOT NULL,
	`day_started_at` integer NOT NULL,
	`purpose` text NOT NULL,
	`sample_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "judge_budget_reservations_purpose_allowed" CHECK("judge_budget_reservations"."purpose" IN ('initial', 'top-ten-escalation', 'moderator-rejudge')),
	CONSTRAINT "judge_budget_reservations_samples_bounded" CHECK("judge_budget_reservations"."sample_count" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `judge_budget_reservations_run_purpose_day_uidx` ON `judge_budget_reservations` (`run_id`,`purpose`,`day_started_at`);--> statement-breakpoint
CREATE INDEX `judge_budget_reservations_day_idx` ON `judge_budget_reservations` (`day_started_at`,`purpose`);--> statement-breakpoint
CREATE INDEX `judge_budget_reservations_contributor_day_idx` ON `judge_budget_reservations` (`contributor_id`,`day_started_at`,`purpose`);
