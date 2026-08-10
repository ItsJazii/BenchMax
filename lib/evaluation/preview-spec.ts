export const PREVIEW_CHECKS = [
  { key: "page-load", kind: "page-load", weightBps: 3_000 },
  { key: "console-errors", kind: "console-errors", weightBps: 2_500 },
  {
    key: "accessibility-critical",
    kind: "accessibility",
    threshold: 0,
    weightBps: 2_500,
  },
  {
    key: "load-performance",
    kind: "performance",
    threshold: 2_500,
    weightBps: 1_000,
  },
  {
    key: "frame-rate",
    kind: "frame-rate",
    threshold: 30,
    weightBps: 1_000,
  },
] as const;

export function buildShowcasePreviewSpec(sourceSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new TypeError("Preview source hash must be SHA-256.");
  }
  return {
    checks: PREVIEW_CHECKS,
    fixedClock: "2026-07-29T09:00:00.000Z",
    interactionSteps: [] as const,
    seed: Number.parseInt(sourceSha256.slice(0, 8), 16),
    viewport: { height: 1_000, width: 1_440 },
  };
}
