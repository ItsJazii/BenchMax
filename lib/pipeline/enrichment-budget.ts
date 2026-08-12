import { EVALUATION_ENVIRONMENT_V1 } from "@/lib/domain/ranked-catalog";

export const MAX_DAILY_ENRICHMENT_BUDGET_MICROUSD = 1_000_000_000;
export const SHOWCASE_ENRICHMENT_SANDBOX_MAX_DURATION_MS =
  EVALUATION_ENVIRONMENT_V1.wallClockSeconds * 1_000;

export function configuredDailyEnrichmentBudget(
  value = process.env.BENCHMAX_ENRICHMENT_DAILY_MICROUSD_BUDGET,
) {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_DAILY_ENRICHMENT_BUDGET_MICROUSD
  ) {
    throw new EnrichmentBudgetConfigurationError();
  }
  return parsed;
}

export function enrichmentBudgetWindow(now = new Date()) {
  const dayStartedAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    dayStartedAt,
    nextDayStartedAt: new Date(dayStartedAt.getTime() + 24 * 60 * 60 * 1_000),
  };
}

export function enrichmentBudgetDeferralAuditId(
  enrichmentId: string,
  dayStartedAt: Date,
) {
  return `showcase-enrichment-budget:${dayStartedAt.toISOString().slice(0, 10)}:${enrichmentId}`;
}

export function enrichmentBudgetConfigurationDeferralAuditId(
  enrichmentId: string,
  dayStartedAt: Date,
) {
  return `showcase-enrichment-budget-configuration:${dayStartedAt.toISOString().slice(0, 10)}:${enrichmentId}`;
}

export function isEnrichmentBudgetExhausted(
  committedMicrousd: number,
  projectedAttemptMicrousd: number,
  budgetMicrousd: number,
) {
  return committedMicrousd + projectedAttemptMicrousd > budgetMicrousd;
}

export function projectedEnrichmentAttemptMicrousd(
  rateMicrousdPerHour: number,
  maximumDurationMs = SHOWCASE_ENRICHMENT_SANDBOX_MAX_DURATION_MS,
) {
  if (
    !Number.isSafeInteger(rateMicrousdPerHour) ||
    rateMicrousdPerHour < 0 ||
    !Number.isSafeInteger(maximumDurationMs) ||
    maximumDurationMs < 1
  ) {
    throw new RangeError("Projected enrichment spend inputs are invalid.");
  }
  const numerator = BigInt(maximumDurationMs) * BigInt(rateMicrousdPerHour);
  return Number(
    (numerator + BigInt(3_599_999)) / BigInt(3_600_000),
  );
}

export class EnrichmentBudgetConfigurationError extends Error {
  constructor() {
    super(
      "The daily preview enrichment budget is not configured. The Test remains public with its preview pending.",
    );
    this.name = "EnrichmentBudgetConfigurationError";
  }
}
