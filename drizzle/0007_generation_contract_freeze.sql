ALTER TABLE `upload_sessions`
ADD `quarantine_cleaned_at` integer;--> statement-breakpoint
CREATE TRIGGER `providers_frozen_after_run`
BEFORE UPDATE OF `api_style`, `endpoint_origin`
ON `providers`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  JOIN `configurations`
    ON `configurations`.`id` = `runs`.`configuration_id`
  WHERE `configurations`.`provider_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'provider execution contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `model_versions_frozen_after_run`
BEFORE UPDATE OF `model_id`, `version_label`, `release_date`, `training_cutoff`
ON `model_versions`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  JOIN `configurations`
    ON `configurations`.`id` = `runs`.`configuration_id`
  WHERE `configurations`.`model_version_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'model version contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `models_frozen_after_run`
BEFORE UPDATE OF `slug`, `name`, `provider`, `provider_id`
ON `models`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  JOIN `configurations`
    ON `configurations`.`id` = `runs`.`configuration_id`
  JOIN `model_versions`
    ON `model_versions`.`id` = `configurations`.`model_version_id`
  WHERE `model_versions`.`model_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'model identity is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `configurations_frozen_after_run`
BEFORE UPDATE OF `provider_id`, `model_version_id`, `harness_id`, `endpoint_name`, `provider_model_id`, `reasoning_level`, `sampling_settings_json`, `settings_hash`, `max_output_tokens`
ON `configurations`
WHEN EXISTS (
  SELECT 1 FROM `runs` WHERE `configuration_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'configuration contract is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `benchmarks_frozen_after_run`
BEFORE UPDATE OF `slug`, `title`, `category`
ON `benchmarks`
WHEN EXISTS (
  SELECT 1
  FROM `runs`
  JOIN `benchmark_versions`
    ON `benchmark_versions`.`id` = `runs`.`benchmark_version_id`
  WHERE `benchmark_versions`.`benchmark_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'benchmark identity is frozen after its first run');
END;--> statement-breakpoint
CREATE TRIGGER `upload_sessions_kind_size_policy`
BEFORE INSERT ON `upload_sessions`
WHEN
  (NEW.`artifact_kind` IN ('source', 'image', 'log') AND NEW.`expected_bytes` > 20971520)
  OR (NEW.`artifact_kind` = 'video' AND NEW.`expected_bytes` > 524288000)
BEGIN
  SELECT RAISE(ABORT, 'upload exceeds the artifact kind size limit');
END;--> statement-breakpoint
CREATE TRIGGER `upload_sessions_submission_quota`
BEFORE INSERT ON `upload_sessions`
WHEN
  COALESCE((
    SELECT SUM(`byte_size`)
    FROM `artifacts`
    WHERE `showcase_id` = NEW.`showcase_id`
  ), 0)
  + COALESCE((
    SELECT SUM(`expected_bytes`)
    FROM `upload_sessions`
    WHERE `showcase_id` = NEW.`showcase_id`
      AND `status` IN ('created', 'uploading')
      AND `expires_at` > NEW.`created_at`
  ), 0)
  + NEW.`expected_bytes` > 1073741824
BEGIN
  SELECT RAISE(ABORT, 'upload exceeds the submission storage quota');
END;--> statement-breakpoint
CREATE TRIGGER `upload_sessions_account_quota`
BEFORE INSERT ON `upload_sessions`
WHEN
  COALESCE((
    SELECT SUM(`byte_size`)
    FROM `artifacts`
    WHERE `uploader_id` = NEW.`user_id`
  ), 0)
  + COALESCE((
    SELECT SUM(`expected_bytes`)
    FROM `upload_sessions`
    WHERE `user_id` = NEW.`user_id`
      AND `status` IN ('created', 'uploading')
      AND `expires_at` > NEW.`created_at`
  ), 0)
  + NEW.`expected_bytes` > 5368709120
BEGIN
  SELECT RAISE(ABORT, 'upload exceeds the account storage quota');
END;
