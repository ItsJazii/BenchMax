DROP INDEX `result_aggregate_snapshots_set_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `result_aggregate_snapshots_active_set_uidx` ON `result_aggregate_snapshots` (`evaluation_version_id`,`source_set_hash`) WHERE "result_aggregate_snapshots"."status" IN ('building', 'published');--> statement-breakpoint
DROP INDEX `result_snapshots_set_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `result_snapshots_active_set_uidx` ON `result_leaderboard_snapshots` (`benchmark_version_id`,`evaluation_version_id`,`result_set_hash`) WHERE "result_leaderboard_snapshots"."status" IN ('building', 'published');
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_entries_sealed_no_insert
BEFORE INSERT ON result_leaderboard_entries
WHEN EXISTS (
  SELECT 1 FROM result_leaderboard_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_entries_sealed_no_update
BEFORE UPDATE ON result_leaderboard_entries
WHEN EXISTS (
  SELECT 1 FROM result_leaderboard_snapshots snapshot
  WHERE snapshot.id = OLD.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_entries_sealed_no_delete
BEFORE DELETE ON result_leaderboard_entries
WHEN EXISTS (
  SELECT 1 FROM result_leaderboard_snapshots snapshot
  WHERE snapshot.id = OLD.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_snapshots_sealed_identity_no_update
BEFORE UPDATE OF benchmark_version_id, evaluation_version_id, version, result_set_hash, published_at, created_at
ON result_leaderboard_snapshots
WHEN OLD.status IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_snapshots_no_reopen
BEFORE UPDATE OF status ON result_leaderboard_snapshots
WHEN (OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded'))
  OR (OLD.status = 'superseded' AND NEW.status != 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard snapshots cannot be reopened');
END;
--> statement-breakpoint
CREATE TRIGGER result_leaderboard_snapshots_sealed_no_delete
BEFORE DELETE ON result_leaderboard_snapshots
WHEN OLD.status IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result leaderboard snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_entries_sealed_no_insert
BEFORE INSERT ON result_aggregate_entries
WHEN EXISTS (
  SELECT 1 FROM result_aggregate_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_entries_sealed_no_update
BEFORE UPDATE ON result_aggregate_entries
WHEN EXISTS (
  SELECT 1 FROM result_aggregate_snapshots snapshot
  WHERE snapshot.id = OLD.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_entries_sealed_no_delete
BEFORE DELETE ON result_aggregate_entries
WHEN EXISTS (
  SELECT 1 FROM result_aggregate_snapshots snapshot
  WHERE snapshot.id = OLD.snapshot_id
    AND snapshot.status IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_snapshots_sealed_identity_no_update
BEFORE UPDATE OF evaluation_version_id, version, source_set_hash, published_at, created_at
ON result_aggregate_snapshots
WHEN OLD.status IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_snapshots_no_reopen
BEFORE UPDATE OF status ON result_aggregate_snapshots
WHEN (OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded'))
  OR (OLD.status = 'superseded' AND NEW.status != 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate snapshots cannot be reopened');
END;
--> statement-breakpoint
CREATE TRIGGER result_aggregate_snapshots_sealed_no_delete
BEFORE DELETE ON result_aggregate_snapshots
WHEN OLD.status IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published result aggregate snapshots are immutable');
END;
