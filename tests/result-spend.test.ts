import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJudgeSpendRecord,
  buildSandboxSpendRecord,
  judgeRatesFromEnv,
  sandboxRateFromEnv,
  SpendPricingConfigurationError,
} from "../lib/data/result-spend";

test("judge spend uses only explicit rates and measured provider tokens", async () => {
  const record = await buildJudgeSpendRecord(
    {
      attemptKey: "judge:run-1:evaluation-1:1:completed",
      durationMs: 1_250,
      evaluationVersionId: "evaluation-1",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      runId: "run-1",
      sampleIndex: 1,
      status: "completed",
    },
    {
      inputMicrousdPerMillionTokens: 2_000_000,
      outputMicrousdPerMillionTokens: 4_000_000,
    },
  );

  assert.equal(record.costMicrousd, 4_000_000);
  assert.equal(record.inputTokens, 1_000_000);
  assert.equal(record.outputTokens, 500_000);
  assert.equal(record.durationMs, 1_250);
  assert.equal(record.currency, "USD");
  assert.match(record.pricingSnapshotJson, /explicit-runtime-configuration/);
  assert.match(
    record.pricingSnapshotJson,
    /BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS/,
  );
  assert.match(record.pricingSnapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(record.usageJson).completeness, "measured");
});

test("judge spend is visibly unpriced when provider usage is unavailable", async () => {
  const record = await buildJudgeSpendRecord(
    {
      attemptKey: "judge:run-1:evaluation-1:2:failed",
      durationMs: 100,
      evaluationVersionId: "evaluation-1",
      inputTokens: null,
      outputTokens: null,
      runId: "run-1",
      sampleIndex: 2,
      status: "failed",
    },
    {
      inputMicrousdPerMillionTokens: 1,
      outputMicrousdPerMillionTokens: 1,
    },
  );

  assert.equal(record.costMicrousd, null);
  assert.equal(
    JSON.parse(record.usageJson).completeness,
    "provider-usage-unavailable",
  );
});

test("sandbox spend rounds fractional microusd up without floating point", async () => {
  const record = await buildSandboxSpendRecord(
    {
      attemptKey: "sandbox:run-1:frontend-evaluation:attempt-1",
      durationMs: 1,
      operation: "frontend-evaluation",
      runId: "run-1",
      status: "completed",
    },
    3_600_001,
  );

  assert.equal(record.costMicrousd, 2);
  assert.equal(record.durationMs, 1);
  assert.match(
    record.pricingSnapshotJson,
    /BENCHMAX_SANDBOX_MICROUSD_PER_HOUR/,
  );
  assert.match(record.pricingSnapshotHash, /^[a-f0-9]{64}$/);
});

test("runtime pricing must be explicit nonnegative integer microusd", () => {
  assert.deepEqual(judgeRatesFromEnv("0", "42"), {
    inputMicrousdPerMillionTokens: 0,
    outputMicrousdPerMillionTokens: 42,
  });
  assert.equal(sandboxRateFromEnv("9000"), 9_000);
  for (const value of ["", "-1", "1.2", "NaN"]) {
    assert.throws(
      () => sandboxRateFromEnv(value),
      SpendPricingConfigurationError,
    );
  }
});
