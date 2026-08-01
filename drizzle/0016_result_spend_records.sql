CREATE TABLE `result_spend_records` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`evaluation_version_id` text,
	`service` text NOT NULL,
	`operation` text NOT NULL,
	`attempt_key` text NOT NULL,
	`sample_index` integer,
	`status` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`cost_microusd` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`pricing_snapshot_json` text NOT NULL,
	`pricing_snapshot_hash` text NOT NULL,
	`usage_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "result_spend_records_service_allowed" CHECK("result_spend_records"."service" IN ('judge', 'sandbox')),
	CONSTRAINT "result_spend_records_operation_allowed" CHECK("result_spend_records"."operation" IN ('judge-sample', 'frontend-evaluation', 'video-inspection')),
	CONSTRAINT "result_spend_records_status_allowed" CHECK("result_spend_records"."status" IN ('completed', 'failed')),
	CONSTRAINT "result_spend_records_currency_usd" CHECK("result_spend_records"."currency" = 'USD'),
	CONSTRAINT "result_spend_records_cost_nonnegative" CHECK("result_spend_records"."cost_microusd" IS NULL OR "result_spend_records"."cost_microusd" >= 0),
	CONSTRAINT "result_spend_records_tokens_nonnegative" CHECK(("result_spend_records"."input_tokens" IS NULL OR "result_spend_records"."input_tokens" >= 0) AND ("result_spend_records"."output_tokens" IS NULL OR "result_spend_records"."output_tokens" >= 0)),
	CONSTRAINT "result_spend_records_duration_nonnegative" CHECK("result_spend_records"."duration_ms" IS NULL OR "result_spend_records"."duration_ms" >= 0),
	CONSTRAINT "result_spend_records_sample_index_bounded" CHECK("result_spend_records"."sample_index" IS NULL OR "result_spend_records"."sample_index" BETWEEN 1 AND 3),
	CONSTRAINT "result_spend_records_judge_shape" CHECK(("result_spend_records"."service" <> 'judge') OR ("result_spend_records"."operation" = 'judge-sample' AND "result_spend_records"."sample_index" IS NOT NULL)),
	CONSTRAINT "result_spend_records_sandbox_shape" CHECK(("result_spend_records"."service" <> 'sandbox') OR ("result_spend_records"."operation" IN ('frontend-evaluation', 'video-inspection') AND "result_spend_records"."duration_ms" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_spend_records_attempt_uidx` ON `result_spend_records` (`attempt_key`);--> statement-breakpoint
CREATE INDEX `result_spend_records_run_idx` ON `result_spend_records` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `result_spend_records_daily_idx` ON `result_spend_records` (`service`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `result_spend_records_no_update`
BEFORE UPDATE ON `result_spend_records`
BEGIN
  SELECT RAISE(ABORT, 'result spend records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `result_spend_records_no_delete`
BEFORE DELETE ON `result_spend_records`
BEGIN
  SELECT RAISE(ABORT, 'result spend records are append-only');
END;
