export const SHOWCASE_ENRICHMENT_STAGE = "enrich-preview" as const;
export const SHOWCASE_ENRICHMENT_STAGE_VERSION = "1" as const;

export type ShowcaseEnrichmentMessage = {
  enrichmentId: string;
  stage: typeof SHOWCASE_ENRICHMENT_STAGE;
  stageVersion: typeof SHOWCASE_ENRICHMENT_STAGE_VERSION;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function showcaseEnrichmentMessage(
  enrichmentId: string,
): ShowcaseEnrichmentMessage {
  if (!UUID_PATTERN.test(enrichmentId)) {
    throw new TypeError("Invalid showcase enrichment identity.");
  }
  return {
    enrichmentId,
    stage: SHOWCASE_ENRICHMENT_STAGE,
    stageVersion: SHOWCASE_ENRICHMENT_STAGE_VERSION,
  };
}

export function isShowcaseEnrichmentMessage(
  value: unknown,
): value is ShowcaseEnrichmentMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ShowcaseEnrichmentMessage>;
  return (
    UUID_PATTERN.test(message.enrichmentId ?? "") &&
    message.stage === SHOWCASE_ENRICHMENT_STAGE &&
    message.stageVersion === SHOWCASE_ENRICHMENT_STAGE_VERSION
  );
}
