export function missingRejudgeSamples(existingSamples: number) {
  return Math.max(
    0,
    3 - Math.min(3, Math.max(0, Math.trunc(existingSamples))),
  );
}
