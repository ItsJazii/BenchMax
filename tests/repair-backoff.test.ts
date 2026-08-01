import assert from "node:assert/strict";
import test from "node:test";
import {
  REPAIR_BACKOFF_BASE_MS,
  REPAIR_BACKOFF_MAX_MS,
  REPAIR_MAX_ATTEMPTS,
  claimRepairDispatchAttempt,
  isActiveEvaluationVersion,
  recordRepairDispatch,
  repairBackoffDelayMs,
  repairRetryDecision,
} from "../lib/pipeline/repair-backoff";

test("repair backoff starts at the two-minute sweep interval and is capped", () => {
  assert.equal(repairBackoffDelayMs(1), REPAIR_BACKOFF_BASE_MS);
  assert.equal(repairBackoffDelayMs(2), REPAIR_BACKOFF_BASE_MS * 2);
  assert.equal(repairBackoffDelayMs(8), REPAIR_BACKOFF_MAX_MS);
  assert.equal(repairBackoffDelayMs(100), REPAIR_BACKOFF_MAX_MS);
});

test("repair retries are durable-policy bounded and honor the backoff boundary", () => {
  const updatedAt = 10_000;
  assert.equal(
    repairRetryDecision({
      attemptCount: 1,
      now: updatedAt + REPAIR_BACKOFF_BASE_MS - 1,
      updatedAt,
    }),
    "backoff",
  );
  assert.equal(
    repairRetryDecision({
      attemptCount: 1,
      now: updatedAt + REPAIR_BACKOFF_BASE_MS,
      updatedAt,
    }),
    "ready",
  );
  assert.equal(
    repairRetryDecision({
      attemptCount: REPAIR_MAX_ATTEMPTS,
      now: updatedAt + REPAIR_BACKOFF_MAX_MS,
      updatedAt,
    }),
    "exhausted",
  );
});

test("only active evaluation versions may enter a repair path", () => {
  assert.equal(isActiveEvaluationVersion("active"), true);
  assert.equal(isActiveEvaluationVersion("frozen"), false);
  assert.equal(isActiveEvaluationVersion("retired"), false);
  assert.equal(isActiveEvaluationVersion(null), false);
});

test("dispatch failures and lost messages spend the durable attempt budget", async () => {
  let row:
    | {
        attempt_count: number;
        id: string;
        lease_expires_at: number;
        status: "failed";
        updated_at: number;
        error_code?: string;
      }
    | undefined;
  const db = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return query.includes("SELECT") ? row ?? null : null;
            },
            async run() {
              if (query.includes("INSERT INTO run_stage_claims")) {
                if (row) return { meta: { changes: 0 } };
                row = {
                  attempt_count: 1,
                  id: String(args[0]),
                  lease_expires_at: Number(args[3]),
                  status: "failed",
                  updated_at: Number(args[4]),
                };
                return { meta: { changes: 1 } };
              }
              if (query.includes("attempt_count = attempt_count + 1")) {
                if (
                  !row ||
                  row.id !== String(args[3]) ||
                  row.attempt_count !== Number(args[4]) ||
                  row.updated_at !== Number(args[5])
                ) {
                  return { meta: { changes: 0 } };
                }
                row = {
                  ...row,
                  attempt_count: row.attempt_count + 1,
                  id: String(args[0]),
                  lease_expires_at: Number(args[1]),
                  updated_at: Number(args[2]),
                };
                return { meta: { changes: 1 } };
              }
              if (query.includes("SET error_code = ?")) {
                if (!row || row.id !== String(args[2])) {
                  return { meta: { changes: 0 } };
                }
                row.error_code = String(args[0]);
                row.updated_at = Number(args[1]);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const runId = "44444444-4444-4444-8444-444444444444";
  const stageVersion = "repair-test-v1";
  const first = await claimRepairDispatchAttempt({
    db,
    now: 10_000,
    runId,
    stageVersion,
  });
  assert.equal(first.action, "attempt");
  if (first.action !== "attempt") assert.fail("first dispatch should claim");
  assert.equal(first.attemptCount, 1);
  assert.equal(
    await recordRepairDispatch({
      claimId: first.claimId,
      db,
      errorCode: "queue_unavailable",
      now: 10_000,
      outcome: "failed",
    }),
    true,
  );
  assert.deepEqual(
    await claimRepairDispatchAttempt({
      db,
      now: 10_000 + REPAIR_BACKOFF_BASE_MS - 1,
      runId,
      stageVersion,
    }),
    { action: "skip", reason: "backoff" },
  );
  const second = await claimRepairDispatchAttempt({
    db,
    now: 10_000 + REPAIR_BACKOFF_BASE_MS,
    runId,
    stageVersion,
  });
  assert.equal(second.action, "attempt");
  if (second.action !== "attempt") assert.fail("dispatch should reopen");
  assert.equal(second.attemptCount, 2);
  assert.equal(
    await recordRepairDispatch({
      claimId: second.claimId,
      db,
      now: second.action === "attempt" ? 10_000 + REPAIR_BACKOFF_BASE_MS : 0,
      outcome: "queued",
    }),
    true,
  );
  const lostMessageRetry = await claimRepairDispatchAttempt({
    db,
    now: 10_000 + REPAIR_BACKOFF_BASE_MS * 3,
    runId,
    stageVersion,
  });
  assert.equal(lostMessageRetry.action, "attempt");
  if (lostMessageRetry.action !== "attempt") {
    assert.fail("lost message should consume a retry dispatch");
  }
  assert.equal(lostMessageRetry.attemptCount, 3);

  if (!row) assert.fail("dispatch row should persist");
  row.attempt_count = REPAIR_MAX_ATTEMPTS;
  row.status = "failed";
  row.updated_at = 10_000 + REPAIR_BACKOFF_BASE_MS;
  assert.deepEqual(
    await claimRepairDispatchAttempt({
      db,
      now: row.updated_at + REPAIR_BACKOFF_MAX_MS,
      runId,
      stageVersion,
    }),
    { action: "skip", reason: "exhausted" },
  );
});
