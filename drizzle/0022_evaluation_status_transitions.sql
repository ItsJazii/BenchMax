CREATE TRIGGER `evaluation_versions_status_transitions`
BEFORE UPDATE OF `status` ON `evaluation_versions`
WHEN NOT (
  NEW.`status` = OLD.`status`
  OR (OLD.`status` = 'draft' AND NEW.`status` IN ('active', 'candidate', 'frozen'))
  OR (OLD.`status` = 'active' AND NEW.`status` = 'frozen')
)
BEGIN
  SELECT RAISE(ABORT, 'illegal evaluation version status transition');
END;
--> statement-breakpoint
CREATE TRIGGER `evaluation_versions_version_frozen`
BEFORE UPDATE OF `version` ON `evaluation_versions`
WHEN NEW.`version` != OLD.`version`
BEGIN
  SELECT RAISE(ABORT, 'evaluation version numbering is immutable');
END;
