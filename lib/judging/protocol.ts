import { unzipSync } from "fflate";
import { z } from "zod";

const injectionPatterns = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?\b/i,
  /\byou\s+are\s+(?:the\s+)?(?:benchmax\s+)?judge\b/i,
  /\b(?:system|assistant|developer)\s*:\s*/i,
  /\bscore(?:_bps)?\s*(?:me|this|the\s+submission)?\s*(?:as|=|:)\s*(?:100|10000|perfect|maximum)\b/i,
  /\bdo\s+not\s+(?:evaluate|score|follow\s+the\s+rubric)\b/i,
  /\buntrusted_evidence_(?:start|end)\b/i,
] as const;

export function screenJudgeInjection(sourceBytes: Uint8Array) {
  const texts = extractTextFiles(sourceBytes);
  const findings: Array<{ file: string; pattern: number }> = [];
  for (const [file, text] of texts) {
    for (const [index, pattern] of injectionPatterns.entries()) {
      if (pattern.test(text)) findings.push({ file, pattern: index + 1 });
    }
  }
  return { flagged: findings.length > 0, findings: findings.slice(0, 50) };
}

export function buildBlindedSource(sourceBytes: Uint8Array): string {
  return extractTextFiles(sourceBytes)
    .map(([path, content]) => {
      const stripped = stripComments(content)
        .replaceAll(/(?:moonshot|kimi|openai|anthropic|claude|gemini)/gi, "[model]")
        .slice(0, 80_000);
      return `FILE ${path}\n${stripped}`;
    })
    .join("\n\n")
    .slice(0, 200_000);
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
