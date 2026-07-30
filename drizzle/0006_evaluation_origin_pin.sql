ALTER TABLE `evaluation_versions`
ADD `endpoint_origin` text NOT NULL DEFAULT 'https://unconfigured.invalid';
--> statement-breakpoint
CREATE TRIGGER `evaluation_versions_frozen_after_run`
BEFORE UPDATE OF
  `judge_provider`,
  `judge_model`,
  `judge_model_version`,
  `endpoint_origin`,
  `prompt_template`,
  `prompt_template_hash`,
  `rubric_protocol_version`,
  `sample_count`,
  `max_tokens_per_sample`,
  `calibration_set_hash`,
  `drift_threshold_bps`
ON `evaluation_versions`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  WHERE `evaluation_version_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(
    ABORT,
    'evaluation version contract is frozen after its first run'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_update`
BEFORE UPDATE ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  WHERE `benchmark_version_id` = OLD.`benchmark_version_id`
)
BEGIN
  SELECT RAISE(
    ABORT,
    'rubric dimensions are frozen after their benchmark version first runs'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_delete`
BEFORE DELETE ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  WHERE `benchmark_version_id` = OLD.`benchmark_version_id`
)
BEGIN
  SELECT RAISE(
    ABORT,
    'rubric dimensions are frozen after their benchmark version first runs'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `rubric_dimensions_frozen_after_run_insert`
BEFORE INSERT ON `rubric_dimensions`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  WHERE `benchmark_version_id` = NEW.`benchmark_version_id`
)
BEGIN
  SELECT RAISE(
    ABORT,
    'rubric dimensions are frozen after their benchmark version first runs'
  );
END;
