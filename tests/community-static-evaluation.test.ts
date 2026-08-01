import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  buildCommunityStaticDefinition,
  hasRunnableStaticEntryPoint,
  supportsCommunityStaticEvaluation,
} from "../lib/evaluation/community-static";

const rubricJson = JSON.stringify([
  {
    key: "task-success",
    title: "Task success",
    description: "The submitted result completes the requested task.",
    mechanism: "judge",
    weightBps: 4000,
  },
  {
    key: "correctness",
    title: "Correctness",
    description: "The result behaves correctly under the supplied evidence.",
    mechanism: "judge",
    weightBps: 3500,
  },
  {
    key: "quality",
    title: "Quality",
    description: "The result is polished and appropriate for the requested test.",
    mechanism: "judge",
    weightBps: 2500,
  },
]);

test("only browser-renderable categories use the static evaluator", () => {
  assert.equal(supportsCommunityStaticEvaluation("frontend"), true);
  assert.equal(supportsCommunityStaticEvaluation("browser-game"), true);
  assert.equal(supportsCommunityStaticEvaluation("browser-3d"), true);
  assert.equal(supportsCommunityStaticEvaluation("other"), false);
});

test("only a directly runnable static archive enters the evaluator", () => {
  assert.equal(
    hasRunnableStaticEntryPoint(
      zipSync({ "index.html": strToU8("<main>Ready</main>") }),
    ),
    true,
  );
  assert.equal(
    hasRunnableStaticEntryPoint(
      zipSync({
        "package.json": strToU8('{"scripts":{"build":"vite build"}}'),
        "src/index.html": strToU8("<main>Needs a build</main>"),
      }),
    ),
    false,
  );
  assert.equal(hasRunnableStaticEntryPoint(strToU8("not a zip")), false);
});

test("generic definitions are deterministic and preserve the frozen rubric", () => {
  const input = {
    benchmarkVersionId: "community-test:v2",
    category: "frontend",
    prompt: "Build the submitted page.",
    rubricJson,
    title: "Community test",
  };
  const first = buildCommunityStaticDefinition(input);
  const second = buildCommunityStaticDefinition(input);
  assert.deepEqual(first, second);
  assert.equal(first?.id, input.benchmarkVersionId);
  assert.equal(first?.rubric.length, 3);
  assert.deepEqual(
    first?.rubric.map(({ judgeSourceRequired, key }) => ({
      judgeSourceRequired,
      key,
    })),
    [
      { judgeSourceRequired: true, key: "task-success" },
      { judgeSourceRequired: true, key: "correctness" },
      { judgeSourceRequired: false, key: "quality" },
    ],
  );
  assert.equal(
    first?.checks.reduce((sum, check) => sum + check.weightBps, 0),
    10_000,
  );
});

test("unsupported categories and invalid frozen rubrics stay evidence-only", () => {
  assert.equal(
    buildCommunityStaticDefinition({
      benchmarkVersionId: "community-test:v1",
      category: "other",
      prompt: "Review this result.",
      rubricJson,
      title: "Other test",
    }),
    null,
  );
  assert.equal(
    buildCommunityStaticDefinition({
      benchmarkVersionId: "community-test:v1",
      category: "frontend",
      prompt: "Build the submitted page.",
      rubricJson: "[]",
      title: "Broken test",
    }),
    null,
  );
});
