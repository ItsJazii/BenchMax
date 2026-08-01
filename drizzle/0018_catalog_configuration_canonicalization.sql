DROP TRIGGER IF EXISTS `result_configurations_identity_frozen`;--> statement-breakpoint
CREATE TRIGGER `result_configurations_identity_frozen`
BEFORE UPDATE OF `model_label`,`model_version_label`,`harness_label`,`reasoning_raw`,`reasoning_normalized`,`declared_settings_json`
ON `result_configurations`
BEGIN
  SELECT RAISE(ABORT, 'declared result metadata is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `result_configurations_catalog_ids_frozen`
BEFORE UPDATE OF `model_version_id`,`harness_id`
ON `result_configurations`
WHEN OLD.`catalog_status` != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'declared result metadata is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `result_configurations_metadata_hash_frozen`
BEFORE UPDATE OF `metadata_hash`
ON `result_configurations`
WHEN OLD.`catalog_status` != 'pending'
  OR NEW.`catalog_status` != 'canonical'
BEGIN
  SELECT RAISE(ABORT, 'declared result metadata is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `result_configurations_catalog_status_transition`
BEFORE UPDATE OF `catalog_status`
ON `result_configurations`
WHEN OLD.`catalog_status` != 'pending'
  OR NEW.`catalog_status` NOT IN ('canonical', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'result catalog status cannot be reopened');
END;
