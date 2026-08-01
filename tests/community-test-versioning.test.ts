import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  assertSubmissionUsesFrozenTestPrompt,
  CREATE_COMMUNITY_TEST_DRAFT_VERSION_SQL,
  CommunityTestPromptMismatchError,
  isEditableCommunityTestVersion,
} from "../lib/domain/community-test-versioning";

function versioningDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE benchmarks (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      status TEXT NOT NULL,
      rubric_status TEXT NOT NULL
    );
    CREATE TABLE benchmark_versions (
      id TEXT PRIMARY KEY,
      benchmark_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      success_criteria_json TEXT NOT NULL,
      category TEXT NOT NULL,
      canonical_prompt TEXT NOT NULL,
      rubric_json TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      harness_contract_json TEXT NOT NULL,
      environment_hash TEXT NOT NULL,
      objective_weight_bps INTEGER NOT NULL,
      judge_weight_bps INTEGER NOT NULL,
      attempt_policy TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      dependency_lock_hash TEXT NOT NULL,
      interaction_script_hash TEXT NOT NULL,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (benchmark_id, version)
    );
  `);
  db.prepare(
    `INSERT INTO benchmarks (id, creator_id, status, rubric_status)
     VALUES (?, ?, 'active', 'approved')`,
  ).run("test-1", "creator-1");
  db.prepare(
    `INSERT INTO benchmark_versions
      (id, benchmark_id, version, title, goal, success_criteria_json,
       category, canonical_prompt, rubric_json, harness_id,
       harness_contract_json, environment_hash, objective_weight_bps,
       judge_weight_bps, attempt_policy, attempt_count,
       dependency_lock_hash, interaction_script_hash, published_at,
       created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'harness-1', '{}', 'env-1',
             0, 10000, 'pass@1', 1, 'deps-1', 'interaction-1', 100, 1, 100)`,
  ).run(
    "test-1:v1",
    "test-1",
    "Original title",
    "Original goal stays frozen forever.",
    '["Original success criterion"]',
    "frontend",
    "Original prompt stays frozen forever.",
    '[{"key":"task-success","weightBps":10000}]',
  );
  return db;
}

function reserveVersion(
  db: DatabaseSync,
  versionId: string,
  title: string,
) {
  return db.prepare(CREATE_COMMUNITY_TEST_DRAFT_VERSION_SQL).all(
    versionId,
    title,
    "Updated goal is long enough to be valid.",
    '["Updated success criterion"]',
    "browser-game",
    "Updated exact prompt is long enough to be valid.",
    '[{"key":"task-success","weightBps":10000}]',
    200,
    200,
    "test-1",
    "creator-1",
  );
}

test("published v1 stays unchanged while an edit reserves a correctly linked v2", () => {
  const db = versioningDatabase();
  const before = db
    .prepare("SELECT * FROM benchmark_versions WHERE id = 'test-1:v1'")
    .get();

  assert.deepEqual(
    reserveVersion(db, "test-1:v2", "Updated title").map((row) => ({
      ...row,
    })),
    [{ id: "test-1:v2", version: 2 }],
  );

  const after = db
    .prepare("SELECT * FROM benchmark_versions WHERE id = 'test-1:v1'")
    .get();
  const v2 = db
    .prepare(
      "SELECT id, benchmark_id, version, title, published_at FROM benchmark_versions WHERE id = 'test-1:v2'",
    )
    .get();
  assert.deepEqual(after, before);
  assert.deepEqual({ ...v2 }, {
    id: "test-1:v2",
    benchmark_id: "test-1",
    version: 2,
    title: "Updated title",
    published_at: null,
  });
});

test("serialized concurrent edit attempts cannot reserve duplicate versions", () => {
  const db = versioningDatabase();

  const first = reserveVersion(db, "test-1:v2", "First edit");
  const staleConcurrent = reserveVersion(
    db,
    "test-1:v2-concurrent",
    "Concurrent edit",
  );
  assert.equal(first.length, 1);
  assert.deepEqual(staleConcurrent, []);
  assert.deepEqual(
    db
      .prepare(
        "SELECT version, count(*) AS copies FROM benchmark_versions GROUP BY version ORDER BY version",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { version: 1, copies: 1 },
      { version: 2, copies: 1 },
    ],
  );
});

test("rubric edits are allowed only on the unpublished version awaiting approval", () => {
  assert.equal(
    isEditableCommunityTestVersion({
      publishedAt: null,
      rubricStatus: "awaiting_approval",
      status: "draft",
      version: 1,
    }),
    true,
  );
  assert.equal(
    isEditableCommunityTestVersion({
      publishedAt: 100,
      rubricStatus: "approved",
      status: "active",
      version: 1,
    }),
    false,
  );
  assert.equal(
    isEditableCommunityTestVersion({
      publishedAt: null,
      rubricStatus: "approved",
      status: "active",
      version: 2,
    }),
    true,
  );
  assert.equal(
    isEditableCommunityTestVersion({
      publishedAt: 200,
      rubricStatus: "approved",
      status: "active",
      version: 2,
    }),
    false,
  );
});

test("submission rejects any prompt that differs from the selected frozen version", () => {
  assert.doesNotThrow(() =>
    assertSubmissionUsesFrozenTestPrompt(
      "Build the exact frozen application.",
      "Build the exact frozen application.",
    ),
  );
  assert.throws(
    () =>
      assertSubmissionUsesFrozenTestPrompt(
        "Build a different application.",
        "Build the exact frozen application.",
      ),
    (error) =>
      error instanceof CommunityTestPromptMismatchError &&
      error.status === 409,
  );
});
