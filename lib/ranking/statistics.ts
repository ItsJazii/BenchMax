export function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) throw new RangeError("Percentile requires values.");
  if (fraction < 0 || fraction > 1) {
    throw new RangeError("Percentile fraction must be between zero and one.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Math.round(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
  );
}

export function summarizeScores(values: readonly number[]) {
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)) {
    throw new RangeError("Scores must be integer basis points.");
  }
  return {
    median: percentile(values, 0.5),
    q1: percentile(values, 0.25),
    q3: percentile(values, 0.75),
    runCount: values.length,
  };
}
