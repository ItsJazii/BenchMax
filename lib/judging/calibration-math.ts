export function meanAbsoluteDriftBps(
  pairs: ReadonlyArray<{ actual: number; expected: number }>,
): number {
  if (pairs.length === 0) {
    throw new Error("Calibration requires at least one score pair.");
  }
  let total = 0;
  for (const pair of pairs) {
    if (
      !Number.isInteger(pair.actual) ||
      !Number.isInteger(pair.expected) ||
      pair.actual < 0 ||
      pair.actual > 10_000 ||
      pair.expected < 0 ||
      pair.expected > 10_000
    ) {
      throw new Error("Calibration scores must be integer basis points.");
    }
    total += Math.abs(pair.actual - pair.expected);
  }
  return Math.round(total / pairs.length);
}
