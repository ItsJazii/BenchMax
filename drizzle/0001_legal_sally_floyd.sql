CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`subject_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "rate_limits_count_positive" CHECK("rate_limits"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE INDEX `rate_limits_subject_action_idx` ON `rate_limits` (`subject_hash`,`action`);