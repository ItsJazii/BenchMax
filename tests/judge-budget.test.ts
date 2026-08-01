import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredDailyJudgeSampleBudget,
  DAILY_JUDGED_SUBMISSION_LIMIT,
  utcDayStartedAt,
} from "../lib/judging/budget";
import { missingRejudgeSamples } from "../lib/pipeline/dispute-rejudge";

test("judge budget uses a fixed UTC day and the five-result launch cap", () => {
  assert.equal(DAILY_JUDGED_SUBMISSION_LIMIT, 5);
  assert.equal(
    utcDayStartedAt(new Date("2026-07-31T23:59:59.999Z")).toISOString(),
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(
    utcDayStartedAt(new Date("2026-08-01T00:00:00.000Z")).toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
});

test("global judge sample budget is explicit and tightly bounded", () => {
  assert.equal(configuredDailyJudgeSampleBudget("250"), 250);
  for (const value of [undefined, "", "0", "-1", "1.5", "1000001", "nope"]) {
    assert.throws(() => configuredDailyJudgeSampleBudget(value));
  }
});

test("dispute rejudgment reuses existing samples and only fills to three", () => {
  assert.equal(missingRejudgeSamples(-1), 3);
  assert.equal(missingRejudgeSamples(0), 3);
  assert.equal(missingRejudgeSamples(1), 2);
  assert.equal(missingRejudgeSamples(2), 1);
  assert.equal(missingRejudgeSamples(3), 0);
  assert.equal(missingRejudgeSamples(4), 0);
});
