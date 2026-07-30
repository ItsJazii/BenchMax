import { unzipSync } from "fflate";
import { z } from "zod";

const injectionPatterns = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?\b/i,
  /\byou\s+are\s+(?:the\s+)?(?:benchmax\s+)?judge\b/i,
  /(?:^|\n)\s*(?:system|assistant|developer)\s*:\s*(?:ignore|disregard|you\s+are|score|do\s+not|follow|return|output|respond)\b/i,
  /\bscore(?:_bps)?\s*(?:me|this|the\s+submission)?\s*(?:as|=|:)\s*(?:100|10000|perfect|maximum)\b/i,
  /\bdo\s+not\s+(?:evaluate|score|follow\s+the\s+rubric)\b/i,
  /\buntrusted_evidence_(?:start|end)\b/i,
] as const;

const modelIdentityPattern =
  /\b(?:moonshot|kimi(?:[- ]?k?\d+(?:\.\d+)?)?|openai|chatgpt|gpt(?:[- ]?\d+(?:\.\d+)?(?:[- ]?(?:codex|chat|turbo|mini))?)?|anthropic|claude|gemini|grok(?:[- ]?\d+(?:\.\d+)?)?|deepseek(?:[- ]?[a-z]?\d+(?:\.\d+)?(?:[- ]?(?:chat|coder|reasoner))?)?|qwen(?:[- ]?[a-z]?\d+(?:\.\d+)?(?:[- ]?(?:chat|coder|instruct))?)?|llama(?:[- ]?\d+(?:\.\d+)?(?:[- ]?(?:chat|coder|instruct))?)?|mistral(?:[- ]?\d+(?:\.\d+)?(?:[- ]?(?:small|medium|large|instruct))?)?|glm(?:[- ]?\d+(?:\.\d+)?(?:[- ]?(?:chat|coder))?)?|codex|copilot|o[134](?:-[a-z0-9.-]+)?)\b/gi;

export type JudgeInjectionFinding = {
  file: string;
  pattern: number;
};

export type RuntimeEvidenceInput = {
  label: string;
  value: unknown;
};

export function screenJudgeInjection(
  sourceBytes: Uint8Array | null,
  runtimeEvidence: readonly RuntimeEvidenceInput[] = [],
) {
  const texts = sourceBytes ? extractTextFiles(sourceBytes) : [];
  const findings: JudgeInjectionFinding[] = [];
  for (const [file, text] of texts) {
    screenText(`source-path:${file}`, file, findings);
    screenText(file, text, findings);
  }
  for (const evidence of runtimeEvidence) {
    for (const [path, text] of collectTextValues(evidence.value)) {
      screenText(`${evidence.label}${path}`, text, findings);
    }
  }
  return { flagged: findings.length > 0, findings: findings.slice(0, 50) };
}

export function buildBlindedSource(sourceBytes: Uint8Array): string {
  return extractTextFiles(sourceBytes)
    .map(([path, content]) => {
      const stripped = redactModelIdentities(stripComments(content)).slice(
        0,
        80_000,
      );
      return `FILE ${redactModelIdentities(path)}\n${stripped}`;
    })
    .join("\n\n")
    .slice(0, 200_000);
}

export function prepareJudgeEvidence(input: {
  includeSource: boolean;
  runtimeEvidence: readonly RuntimeEvidenceInput[];
  sourceBytes: Uint8Array | null;
}) {
  const injection = screenJudgeInjection(
    input.sourceBytes,
    input.runtimeEvidence,
  );
  const sections = input.runtimeEvidence.map((evidence) => ({
    label: evidence.label,
    text: serializeBlindedEvidence(evidence.value),
  }));
  if (input.includeSource && input.sourceBytes) {
    sections.push({
      label: "generated-source",
      text: buildBlindedSource(input.sourceBytes),
    });
  }
  return {
    injection,
    untrustedEvidence: buildUntrustedEvidenceEnvelope(sections),
  };
}

export function buildJudgePromptPayload(input: {
  benchmarkPrompt: string;
  injectionFlag: boolean;
  objectiveResults: readonly {
    checkKey: string;
    dimensionKey: string;
    scoreBps: number;
    status: string;
  }[];
  rubric: readonly {
    description: string;
    key: string;
    title: string;
    weightBps: number;
  }[];
  untrustedEvidence: string;
}) {
  return {
    benchmark: input.benchmarkPrompt,
    injectionScreenFlag: input.injectionFlag,
    objectiveResults: input.objectiveResults.map((row) => ({
      checkKey: row.checkKey,
      dimensionKey: row.dimensionKey,
      scoreBps: row.scoreBps,
      status: row.status,
    })),
    rubric: input.rubric.map((dimension) => ({
      description: dimension.description,
      key: dimension.key,
      title: dimension.title,
      weightBps: dimension.weightBps,
    })),
    untrustedEvidence: input.untrustedEvidence,
  };
}

export function redactModelIdentities(value: string) {
  return value.replace(modelIdentityPattern, "[model]");
}

export function buildUntrustedEvidenceEnvelope(
  sections: readonly { label: string; text: string }[],
) {
  const body = sections
    .map(
      ({ label, text }) =>
        `EVIDENCE_SECTION ${sanitizeEvidenceText(label, 200)}\n${sanitizeEvidenceText(text, 200_000)}`,
    )
    .join("\n\n")
    .slice(0, 300_000);
  return `UNTRUSTED_EVIDENCE_START\n${body}\nUNTRUSTED_EVIDENCE_END`;
}

function screenText(
  file: string,
  text: string,
  findings: JudgeInjectionFinding[],
) {
  for (const [index, pattern] of injectionPatterns.entries()) {
    if (pattern.test(text)) findings.push({ file, pattern: index + 1 });
  }
}

function collectTextValues(
  value: unknown,
  path = "",
  depth = 0,
): Array<[string, string]> {
  if (depth > 20) return [];
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectTextValues(item, `${path}[${index}]`, depth + 1),
    );
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    [`${path}.${key}`, key] as [string, string],
    ...collectTextValues(item, `${path}.${key}`, depth + 1),
  ]);
}

function serializeBlindedEvidence(value: unknown) {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "string") {
      return redactModelIdentities(item).slice(0, 20_000);
    }
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular]";
      seen.add(item);
    }
    return item;
  });
  return (serialized ?? "null").slice(0, 200_000);
}

function sanitizeEvidenceText(value: string, maximumLength: number) {
  return redactModelIdentities(value)
    .replace(/untrusted_evidence_(?:start|end)\b/gi, "[blocked-delimiter]")
    .slice(0, maximumLength);
}

function extractTextFiles(bytes: Uint8Array): Array<[string, string]> {
  const archive = unzipSync(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: Array<[string, string]> = [];
  for (const path of Object.keys(archive).sort()) {
    if (!/\.(?:html?|css|m?js|jsx|ts|tsx|json|md|txt)$/i.test(path)) continue;
    try {
      files.push([path, decoder.decode(archive[path])]);
    } catch {
      // Binary or invalid UTF-8 input is excluded from judge evidence.
    }
  }
  return files;
}

function stripComments(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function createJudgeOutputSchema(dimensionKeys: readonly string[]) {
  const allowed = new Set(dimensionKeys);
  return z
    .object({
      dimensions: z
        .array(
          z.object({
            key: z.string().refine((value) => allowed.has(value)),
            score_bps: z.number().int().min(0).max(10_000),
            reasoning: z.string().trim().min(1).max(1_500),
          }).strict(),
        )
        .length(dimensionKeys.length),
    })
    .strict()
    .superRefine((value, context) => {
      const keys = value.dimensions.map((dimension) => dimension.key);
      if (new Set(keys).size !== dimensionKeys.length) {
        context.addIssue({
          code: "custom",
          message: "Every judge dimension must appear exactly once.",
        });
      }
    });
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("Median requires values.");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
