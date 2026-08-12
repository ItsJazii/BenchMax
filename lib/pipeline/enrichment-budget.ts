export const MAX_DAILY_ENRICHMENT_BUDGET_MICROUSD = 1_000_000_000;

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
  spentMicrousd: number,
  budgetMicrousd: number,
) {
  return spentMicrousd >= budgetMicrousd;
}

export class EnrichmentBudgetConfigurationError extends Error {
  constructor() {
    super(
      "The daily preview enrichment budget is not configured. The Test remains public with its preview pending.",
    );
    this.name = "EnrichmentBudgetConfigurationError";
  }
}
