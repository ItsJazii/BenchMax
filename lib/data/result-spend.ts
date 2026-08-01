import { resultSpendRecords } from "@/db/schema";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";

const TOKENS_PER_MILLION = 1_000_000;
const MILLIS_PER_HOUR = 3_600_000;
const MAX_RATE_MICROUSD = 1_000_000_000_000;

export type ResultSpendStatus = "completed" | "failed";
export type ResultSpendRecord = typeof resultSpendRecords.$inferInsert;

export type JudgeSpendInput = {
  attemptKey: string;
  createdAt?: Date;
  durationMs: number;
  evaluationVersionId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  runId: string;
  sampleIndex: number;
  status: ResultSpendStatus;
};

export type SandboxSpendInput = {
  attemptKey: string;
  createdAt?: Date;
  durationMs: number;
  evaluationVersionId?: string | null;
  operation: "frontend-evaluation" | "video-inspection";
  runId: string;
  status: ResultSpendStatus;
};

export async function buildJudgeSpendRecord(
  input: JudgeSpendInput,
  rates = judgeRatesFromEnv(),
): Promise<ResultSpendRecord> {
  assertNonnegativeIntegerOrNull(input.inputTokens, "inputTokens");
  assertNonnegativeIntegerOrNull(input.outputTokens, "outputTokens");
  assertNonnegativeInteger(input.durationMs, "durationMs");
  if (!Number.isSafeInteger(input.sampleIndex) || input.sampleIndex < 1 || input.sampleIndex > 3) {
    throw new RangeError("Judge spend sample index must be between 1 and 3.");
  }
  const pricingSnapshot = {
    currency: "USD",
    inputRate: {
      environmentVariable: "BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS",
      microusdPerMillionTokens: rates.inputMicrousdPerMillionTokens,
    },
    outputRate: {
      environmentVariable: "BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS",
      microusdPerMillionTokens: rates.outputMicrousdPerMillionTokens,
    },
    source: "explicit-runtime-configuration",
    version: 1,
  } as const;
  const hasCompleteUsage = input.inputTokens !== null && input.outputTokens !== null;
  const costMicrousd = hasCompleteUsage
    ? ceilMultiplyDivide(
        input.inputTokens!,
        rates.inputMicrousdPerMillionTokens,
        TOKENS_PER_MILLION,
      ) +
      ceilMultiplyDivide(
        input.outputTokens!,
        rates.outputMicrousdPerMillionTokens,
        TOKENS_PER_MILLION,
      )
    : null;
  return {
    id: crypto.randomUUID(),
    runId: input.runId,
    evaluationVersionId: input.evaluationVersionId,
    service: "judge",
    operation: "judge-sample",
    attemptKey: input.attemptKey,
    sampleIndex: input.sampleIndex,
    status: input.status,
    currency: "USD",
    costMicrousd,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    durationMs: input.durationMs,
    pricingSnapshotJson: canonicalJson(pricingSnapshot),
    pricingSnapshotHash: await canonicalSha256(pricingSnapshot),
    usageJson: canonicalJson({
      completeness: hasCompleteUsage ? "measured" : "provider-usage-unavailable",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      durationMs: input.durationMs,
      version: 1,
    }),
    createdAt: input.createdAt ?? new Date(),
  };
}

export async function buildSandboxSpendRecord(
  input: SandboxSpendInput,
  rateMicrousdPerHour = sandboxRateFromEnv(),
): Promise<ResultSpendRecord> {
  assertNonnegativeInteger(input.durationMs, "durationMs");
  const pricingSnapshot = {
    currency: "USD",
    rate: {
      environmentVariable: "BENCHMAX_SANDBOX_MICROUSD_PER_HOUR",
      microusdPerHour: rateMicrousdPerHour,
    },
    source: "explicit-runtime-configuration",
    version: 1,
  } as const;
  return {
    id: crypto.randomUUID(),
    runId: input.runId,
    evaluationVersionId: input.evaluationVersionId ?? null,
    service: "sandbox",
    operation: input.operation,
    attemptKey: input.attemptKey,
    sampleIndex: null,
    status: input.status,
    currency: "USD",
    costMicrousd: ceilMultiplyDivide(
      input.durationMs,
      rateMicrousdPerHour,
      MILLIS_PER_HOUR,
    ),
    inputTokens: null,
    outputTokens: null,
    durationMs: input.durationMs,
    pricingSnapshotJson: canonicalJson(pricingSnapshot),
    pricingSnapshotHash: await canonicalSha256(pricingSnapshot),
    usageJson: canonicalJson({ durationMs: input.durationMs, version: 1 }),
    createdAt: input.createdAt ?? new Date(),
  };
}

export async function recordResultSpend(record: ResultSpendRecord) {
  const { getDb } = await import("@/db");
  await getDb().insert(resultSpendRecords).values(record).onConflictDoNothing();
}

export async function getRunSpendSummary(runId: string) {
  const { env } = await import("cloudflare:workers");
  const rows = await querySpendBreakdown(
    env.DB,
    "run_id = ?",
    [runId],
  );
  return summarizeSpend(rows);
}

export async function getDailySpendSummary(dayStartedAt = utcDayStartedAt()) {
  const { env } = await import("cloudflare:workers");
  const start = dayStartedAt.getTime();
  const end = start + 24 * 60 * 60 * 1_000;
  const rows = await querySpendBreakdown(
    env.DB,
    "created_at >= ? AND created_at < ?",
    [start, end],
  );
  return {
    dayStartedAt: new Date(start).toISOString(),
    dayEndsAt: new Date(end).toISOString(),
    ...summarizeSpend(rows),
  };
}

type SpendBreakdownRow = {
  attempt_count: number;
  duration_ms: number;
  first_recorded_at: number;
  input_tokens: number;
  last_recorded_at: number;
  operation: string;
  output_tokens: number;
  priced_cost_microusd: number;
  service: string;
  status: string;
  unpriced_attempt_count: number;
};

async function querySpendBreakdown(
  db: D1Database,
  whereClause: "run_id = ?" | "created_at >= ? AND created_at < ?",
  bindings: Array<number | string>,
) {
  return (
    await db.prepare(
      `SELECT
       service,
       operation,
       status,
       count(*) AS attempt_count,
       coalesce(sum(cost_microusd), 0) AS priced_cost_microusd,
       sum(CASE WHEN cost_microusd IS NULL THEN 1 ELSE 0 END) AS unpriced_attempt_count,
       coalesce(sum(input_tokens), 0) AS input_tokens,
       coalesce(sum(output_tokens), 0) AS output_tokens,
       coalesce(sum(duration_ms), 0) AS duration_ms,
       min(created_at) AS first_recorded_at,
       max(created_at) AS last_recorded_at
     FROM result_spend_records
     WHERE ${whereClause}
     GROUP BY service, operation, status
     ORDER BY service, operation, status`,
    )
      .bind(...bindings)
      .all<SpendBreakdownRow>()
  ).results;
}

function summarizeSpend(rows: SpendBreakdownRow[]) {
  const breakdown = rows.map((row) => ({
    attemptCount: Number(row.attempt_count),
    durationMs: Number(row.duration_ms),
    firstRecordedAt: new Date(Number(row.first_recorded_at)).toISOString(),
    inputTokens: Number(row.input_tokens),
    lastRecordedAt: new Date(Number(row.last_recorded_at)).toISOString(),
    operation: row.operation,
    outputTokens: Number(row.output_tokens),
    pricedCostMicrousd: Number(row.priced_cost_microusd),
    service: row.service,
    status: row.status,
    unpricedAttemptCount: Number(row.unpriced_attempt_count),
  }));
  return {
    currency: "USD" as const,
    pricedCostMicrousd: breakdown.reduce(
      (sum, item) => sum + item.pricedCostMicrousd,
      0,
    ),
    unpricedAttemptCount: breakdown.reduce(
      (sum, item) => sum + item.unpricedAttemptCount,
      0,
    ),
    breakdown,
  };
}

function utcDayStartedAt(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function judgeRatesFromEnv(
  inputRate = process.env.BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS,
  outputRate = process.env.BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
) {
  return {
    inputMicrousdPerMillionTokens: configuredRate(
      "BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS",
      inputRate,
    ),
    outputMicrousdPerMillionTokens: configuredRate(
      "BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS",
      outputRate,
    ),
  };
}

export function sandboxRateFromEnv(
  value = process.env.BENCHMAX_SANDBOX_MICROUSD_PER_HOUR,
) {
  return configuredRate("BENCHMAX_SANDBOX_MICROUSD_PER_HOUR", value);
}

function configuredRate(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new SpendPricingConfigurationError(name);
  }
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_RATE_MICROUSD
  ) {
    throw new SpendPricingConfigurationError(name);
  }
  return parsed;
}

function ceilMultiplyDivide(value: number, rate: number, divisor: number) {
  assertNonnegativeInteger(value, "usage");
  assertNonnegativeInteger(rate, "rate");
  const numerator = BigInt(value) * BigInt(rate);
  const result =
    (numerator + BigInt(divisor) - BigInt(1)) / BigInt(divisor);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated spend exceeds the safe integer range.");
  }
  return Number(result);
}

function assertNonnegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer.`);
  }
}

function assertNonnegativeIntegerOrNull(value: number | null, name: string) {
  if (value !== null) assertNonnegativeInteger(value, name);
}

export class SpendPricingConfigurationError extends Error {
  readonly code = "spend_pricing_configuration_error";

  constructor(readonly key: string) {
    super(`The explicit monetary rate ${key} is not configured.`);
    this.name = "SpendPricingConfigurationError";
  }
}
