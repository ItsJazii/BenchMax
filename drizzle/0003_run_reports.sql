PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_abuse_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `reporter_user_id` text,
  `showcase_id` text,
  `run_id` text,
  `reason` text NOT NULL,
  `details` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `abuse_reports_exactly_one_target` CHECK((`showcase_id` IS NOT NULL AND `run_id` IS NULL) OR (`showcase_id` IS NULL AND `run_id` IS NOT NULL)),
  CONSTRAINT `abuse_reports_reason_allowed` CHECK(`reason` IN ('malware', 'copyright', 'fraud', 'harassment', 'other')),
  CONSTRAINT `abuse_reports_status_allowed` CHECK(`status` IN ('open', 'reviewing', 'resolved', 'dismissed')),
  CONSTRAINT `abuse_reports_details_length` CHECK(length(`details`) BETWEEN 10 AND 2000)
);--> statement-breakpoint
INSERT INTO `__new_abuse_reports` (`id`, `reporter_user_id`, `showcase_id`, `run_id`, `reason`, `details`, `status`, `created_at`)
SELECT `id`, `reporter_user_id`, `showcase_id`, NULL, `reason`, `details`, `status`, `created_at`
FROM `abuse_reports`;--> statement-breakpoint
DROP TABLE `abuse_reports`;--> statement-breakpoint
ALTER TABLE `__new_abuse_reports` RENAME TO `abuse_reports`;--> statement-breakpoint
CREATE INDEX `abuse_reports_status_idx` ON `abuse_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `abuse_reports_showcase_idx` ON `abuse_reports` (`showcase_id`);--> statement-breakpoint
CREATE INDEX `abuse_reports_run_idx` ON `abuse_reports` (`run_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
