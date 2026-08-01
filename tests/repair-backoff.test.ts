import assert from "node:assert/strict";
import test from "node:test";
import {
  REPAIR_BACKOFF_BASE_MS,
  REPAIR_BACKOFF_MAX_MS,
  REPAIR_MAX_ATTEMPTS,
  isActiveEvaluationVersion,
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
