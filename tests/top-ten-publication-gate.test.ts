import assert from "node:assert/strict";
import test from "node:test";
import { hasPendingTopTenEscalations } from "../lib/ranking/top-ten-gate";

test("a leaderboard candidate stays non-public until every top-ten row has k=3", () => {
  assert.equal(
    hasPendingTopTenEscalations([
      { rank: 1, sampleCount: 3 },
      { rank: 2, sampleCount: 1 },
      { rank: 11, sampleCount: 1 },
    ]),
    true,
  );
  assert.equal(
    hasPendingTopTenEscalations([
      { rank: 1, sampleCount: 3 },
      { rank: 10, sampleCount: 3 },
      { rank: 11, sampleCount: 1 },
    ]),
    false,
  );
});
