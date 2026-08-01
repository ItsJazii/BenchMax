import type { FrontendBenchmarkDefinition } from "@/benchmarks/frontend/manifest";
import {
  requiresJudgeSource,
  rubricDraftSchema,
} from "@/lib/judging/rubric-draft";
import { listBoundedZipEntries } from "@/lib/security/bounded-zip";

const STATIC_EVALUATION_CATEGORIES = new Set([
  "frontend",
  "browser-game",
  "browser-3d",
]);

const genericChecks = [
  { key: "page-load", kind: "page-load", weightBps: 3000 },
  { key: "console-errors", kind: "console-errors", weightBps: 2000 },
  {
    key: "accessibility-critical",
    kind: "accessibility",
    threshold: 0,
    weightBps: 2000,
  },
  {
    key: "bundle-size",
    kind: "bundle-size",
    threshold: 1_500_000,
    weightBps: 1000,
  },
  {
    key: "load-performance",
    kind: "performance",
    threshold: 2500,
    weightBps: 1000,
  },
  {
    key: "frame-rate",
    kind: "frame-rate",
    threshold: 30,
    weightBps: 1000,
  },
] as const satisfies FrontendBenchmarkDefinition["checks"];

export function supportsCommunityStaticEvaluation(category: string) {
  return STATIC_EVALUATION_CATEGORIES.has(category);
}

export function hasRunnableStaticEntryPoint(bytes: Uint8Array) {
  try {
    const paths = listBoundedZipEntries(bytes);
    return paths.some(
      (path) => path.replace(/^\.\//u, "").toLowerCase() === "index.html",
    );
  } catch {
    return false;
  }
}

export function buildCommunityStaticDefinition(input: {
  benchmarkVersionId: string;
  category: string;
  prompt: string;
  rubricJson: string;
  title: string;
}): FrontendBenchmarkDefinition | null {
  if (!supportsCommunityStaticEvaluation(input.category)) return null;
  let rubricValue: unknown;
  try {
    rubricValue = JSON.parse(input.rubricJson);
  } catch {
    return null;
  }
  const rubric = rubricDraftSchema.safeParse({ dimensions: rubricValue });
  if (!rubric.success) return null;
  return {
    id: input.benchmarkVersionId,
    slug: `community-${stableSeed(input.benchmarkVersionId)}`,
    title: input.title,
    version: 1,
    canonicalPrompt: input.prompt,
    viewport: { width: 1440, height: 1000 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: stableSeed(input.benchmarkVersionId),
    interactionSteps: [
      { action: "assert-visible", target: "main" },
    ],
    checks: genericChecks,
    rubric: rubric.data.dimensions.map((dimension) => ({
      key: dimension.key,
      title: dimension.title,
      mechanism: "judge" as const,
      weightBps: dimension.weightBps,
      judgeSourceRequired: requiresJudgeSource(dimension),
    })),
  };
}

function stableSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
