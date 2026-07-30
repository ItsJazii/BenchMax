export type FrozenEvaluatorCheck = {
  key: string;
  kind: string;
  weightBps: number;
};

export type EvaluatorObjectiveResult = {
  checkKey: string;
  kind: string;
  scoreBps: number;
  weightBps: number;
};

export function evaluatorReportContractError(input: {
  checks: readonly FrozenEvaluatorCheck[];
  objectiveResults: readonly EvaluatorObjectiveResult[];
  weightedScoreBps: number;
}): string | null {
  if (input.objectiveResults.length !== input.checks.length) {
    return "objective_result_count_mismatch";
  }
  const expected = new Map(input.checks.map((check) => [check.key, check]));
  if (expected.size !== input.checks.length) {
    return "benchmark_check_keys_not_unique";
  }
  const seen = new Set<string>();
  for (const result of input.objectiveResults) {
    if (seen.has(result.checkKey)) return "report_check_keys_not_unique";
    seen.add(result.checkKey);
    const check = expected.get(result.checkKey);
    if (!check) return "report_check_key_not_allowed";
    if (
      result.kind !== check.kind ||
      result.weightBps !== check.weightBps
    ) {
      return "report_check_contract_mismatch";
    }
  }
  const weightedScoreBps = Math.round(
    input.objectiveResults.reduce(
      (sum, result) => sum + result.scoreBps * result.weightBps,
      0,
    ) / 10_000,
  );
  if (weightedScoreBps !== input.weightedScoreBps) {
    return "report_weighted_score_mismatch";
  }
  return null;
}
