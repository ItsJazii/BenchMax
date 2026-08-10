export function enrichmentRetryDelaySeconds(
  leaseExpiresAt: Date,
  now = Date.now(),
) {
  return Math.min(
    300,
    Math.max(5, Math.ceil((leaseExpiresAt.getTime() - now) / 1000)),
  );
}

export function sanitizeEnrichmentFailureCode(value: string) {
  return /^[a-z0-9_:-]{1,80}$/.test(value)
    ? value
    : "preview_enrichment_failed";
}

export function enrichmentErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return sanitizeEnrichmentFailureCode(error.code);
  }
  return sanitizeEnrichmentFailureCode(
    error instanceof Error
      ? error.name
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toLowerCase()
      : "preview_enrichment_failed",
  );
}
