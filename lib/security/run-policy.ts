export type RunStatus =
  | "draft"
  | "queued_generation"
  | "generating"
  | "generated"
  | "queued_evaluation"
  | "evaluating"
  | "judging"
  | "scored"
  | "published"
  | "generation_failed"
  | "evaluation_failed"
  | "disqualified";

const transitions: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  draft: new Set(["disqualified"]),
  queued_generation: new Set(),
  generating: new Set(),
  generated: new Set(),
  queued_evaluation: new Set([
    "evaluating",
    "judging",
    "evaluation_failed",
    "disqualified",
  ]),
  evaluating: new Set(["judging", "scored", "evaluation_failed", "disqualified"]),
  judging: new Set(["scored", "evaluation_failed", "disqualified"]),
  scored: new Set(["published", "evaluation_failed", "disqualified"]),
  published: new Set(["disqualified"]),
  generation_failed: new Set(),
  evaluation_failed: new Set([
    "queued_evaluation",
    "judging",
    "scored",
    "disqualified",
  ]),
  disqualified: new Set([]),
};

export function isAllowedRunTransition(
  from: RunStatus,
  to: RunStatus,
): boolean {
  return transitions[from]?.has(to) ?? false;
}

export function assertSafeProviderOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeProviderOriginError();
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateIpLiteral(hostname)
  ) {
    throw new UnsafeProviderOriginError();
  }
  return url;
}

function isPrivateIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    return (
      parts.some((part) => part < 0 || part > 255) ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }
  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
}

export class UnsafeProviderOriginError extends Error {
  readonly status = 400;

  constructor() {
    super("Provider endpoint origin is not allowed.");
    this.name = "UnsafeProviderOriginError";
  }
}
