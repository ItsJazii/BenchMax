export type NormalizedReasoning =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "max"
  | "unknown";

export function normalizeReasoning(value: string): NormalizedReasoning {
  const normalized = value.trim().toLowerCase();
  if (/^(?:none|off|disabled|0)$/.test(normalized)) return "none";
  if (/^(?:low|minimal|1)$/.test(normalized)) return "low";
  if (/^(?:medium|standard|2)$/.test(normalized)) return "medium";
  if (/^(?:high|3)$/.test(normalized)) return "high";
  if (/^(?:max|maximum|xhigh|4)$/.test(normalized)) return "max";
  return "unknown";
}

function normalizeCatalogLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

export function resultConfigurationIdentityMaterial(input: {
  declaredSettings: unknown;
  harnessId: string | null;
  harnessLabel: string;
  modelLabel: string;
  modelVersionId: string | null;
  modelVersionLabel: string;
  reasoningNormalized: NormalizedReasoning;
}) {
  return {
    declaredSettings: input.declaredSettings,
    harness: input.harnessId
      ? { id: input.harnessId }
      : { label: normalizeCatalogLabel(input.harnessLabel) },
    modelVersion: input.modelVersionId
      ? { id: input.modelVersionId }
      : {
          modelLabel: normalizeCatalogLabel(input.modelLabel),
          versionLabel: normalizeCatalogLabel(input.modelVersionLabel),
        },
    reasoning: input.reasoningNormalized,
    version: 2,
  };
}
