import assert from "node:assert/strict";
import test from "node:test";
import { computeSubmissionState } from "../lib/domain/submission-state";

const published = {
  showcaseStatus: "published",
  safetyStatus: "approved",
  judgeStatus: "not_queued",
  rankingStatus: "pending",
  rank: null,
  runStatus: null,
};

test("safe published Tests are Awaiting review without a judge run", () => {
  assert.deepEqual(computeSubmissionState(published), {
    code: "awaiting_review",
    label: "Awaiting review",
    detail:
      "This Test is safe and public. Reviews and ranking can be added later.",
    tone: "pending",
    publicVisible: true,
    ranked: false,
    blockedReason: null,
  });
});

test("ranked means present in a current published leaderboard snapshot", () => {
  const state = computeSubmissionState({ ...published, rank: 7 });
  assert.equal(state.label, "Ranked");
  assert.equal(state.ranked, true);
  assert.match(state.detail, /#7/);
});

test("completed judge work maps to the simple Reviewed state", () => {
  const state = computeSubmissionState({
    ...published,
    judgeStatus: "unranked",
    rankingStatus: "insufficient_evidence",
    runStatus: "published",
  });
  assert.equal(state.label, "Reviewed");
  assert.equal(state.publicVisible, true);
  assert.equal(state.ranked, false);
});

test("delayed or failed optional review remains Awaiting review and public", () => {
  const overdue = computeSubmissionState({
    ...published,
    judgeStatus: "overdue",
  });
  assert.equal(overdue.code, "awaiting_review");
  assert.equal(overdue.publicVisible, true);

  const failed = computeSubmissionState({
    ...published,
    judgeStatus: "failed",
    runStatus: "evaluation_failed",
    failureCode: "sandbox_timeout",
  });
  assert.equal(failed.code, "awaiting_review");
  assert.equal(failed.publicVisible, true);
});

test("draft processing failure is private and retryable", () => {
  const state = computeSubmissionState({
    ...published,
    showcaseStatus: "draft",
    safetyStatus: "scanning",
    failureCode: "scanner_timeout",
  });
  assert.equal(state.code, "processing_failed");
  assert.equal(state.label, "Processing failed");
  assert.equal(state.publicVisible, false);
  assert.match(state.blockedReason ?? "", /scanner timeout/);
});

test("unsafe draft evidence is Blocked and not public", () => {
  const state = computeSubmissionState({
    ...published,
    showcaseStatus: "draft",
    safetyStatus: "blocked",
  });
  assert.equal(state.code, "blocked");
  assert.equal(state.label, "Blocked");
  assert.equal(state.publicVisible, false);
  assert.match(state.blockedReason ?? "", /safety scan/i);
});
