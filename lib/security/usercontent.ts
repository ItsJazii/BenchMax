const RESULT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_RUN_SLUG_PATTERN = /^run-[0-9a-f]{12}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredUsercontentOrigin(
  value = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN,
): string | null {
  const usercontentOrigin = parseHttpsOrigin(value);
  const appOrigin = parseHttpsOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!usercontentOrigin || usercontentOrigin === appOrigin) return null;
  return usercontentOrigin;
}

export function buildResultArtifactUrl(
  slug: string,
  artifactId: string,
  originValue = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN,
): string {
  const origin = configuredUsercontentOrigin(originValue);
  if (!origin) throw new Error("A distinct HTTPS user-content origin is required.");
  if (!RESULT_SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(artifactId)) {
    throw new Error("Invalid public result artifact identity.");
  }
  return `${origin}/results/${slug}/artifacts/${artifactId}`;
}

export function buildLegacyRunArtifactUrl(
  slug: string,
  artifactId: string,
  originValue = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN,
): string {
  const origin = configuredUsercontentOrigin(originValue);
  if (!origin) throw new Error("A distinct HTTPS user-content origin is required.");
  if (!LEGACY_RUN_SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(artifactId)) {
    throw new Error("Invalid public legacy artifact identity.");
  }
  return `${origin}/runs/${slug}/artifacts/${artifactId}`;
}

export function isResultSlug(value: string): boolean {
  return RESULT_SLUG_PATTERN.test(value);
}

export function isLegacyRunSlug(value: string): boolean {
  return LEGACY_RUN_SLUG_PATTERN.test(value);
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
