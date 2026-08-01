import assert from "node:assert/strict";
import test from "node:test";
import { computeSubmissionState } from "../lib/domain/submission-state";

const published = {
  showcaseStatus: "published",
  safetyStatus: "approved",
  judgeStatus: "queued",
  rankingStatus: "pending",
  rank: null,
  runStatus: "queued_evaluation",
};

test("safe published results are public before AI ranking", () => {
  assert.deepEqual(computeSubmissionState(published), {
    code: "public_pending_review",
    label: "Public — pending AI review",
    detail:
      "The result is already visible. AI judging and ranking may take up to 24 hours.",
    tone: "pending",
    publicVisible: true,
    ranked: false,
    blockedReason: null,
  });
});

test("ranked means present in a current published leaderboard snapshot", () => {
  const state = computeSubmissionState({ ...published, rank: 7 });
  assert.equal(state.label, "Public — ranked #7");
  assert.equal(state.ranked, true);
  assert.equal(state.blockedReason, null);
});

test("ranking gates produce an explicit not-ranked reason", () => {
  const state = computeSubmissionState({
    ...published,
    judgeStatus: "unranked",
    rankingStatus: "insufficient_evidence",
    runStatus: "published",
  });
  assert.equal(state.label, "Public — scored, not ranked");
  assert.match(state.blockedReason ?? "", /not sufficient/i);
  assert.equal(state.publicVisible, true);
});

test("overdue and failed reviews keep public visibility", () => {
  const overdue = computeSubmissionState({
    ...published,
    judgeStatus: "overdue",
  });
  assert.equal(overdue.code, "public_review_delayed");
  assert.equal(overdue.publicVisible, true);

  const failed = computeSubmissionState({
    ...published,
    judgeStatus: "failed",
    runStatus: "evaluation_failed",
    failureCode: "sandbox_timeout",
  });
  assert.equal(failed.code, "public_review_failed");
  assert.match(failed.blockedReason ?? "", /sandbox timeout/);
  assert.equal(failed.publicVisible, true);
});

test("draft scan failures are not presented as public", () => {
  const state = computeSubmissionState({
    ...published,
    showcaseStatus: "draft",
    safetyStatus: "blocked",
  });
  assert.equal(state.code, "blocked");
  assert.equal(state.publicVisible, false);
  assert.match(state.blockedReason ?? "", /safety scan/i);
});
