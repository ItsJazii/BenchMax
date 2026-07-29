import { z } from "zod";

export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_LOG_BYTES = 20 * 1024 * 1024;
export const MAX_SUBMISSION_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;

export const artifactKinds = ["source", "video", "image", "log"] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

const mimePolicy: Record<
  ArtifactKind,
  { allowed: ReadonlySet<string>; maxBytes: number }
> = {
  source: {
    allowed: new Set([
      "application/zip",
      "application/x-zip-compressed",
      "text/plain",
    ]),
    maxBytes: MAX_SOURCE_BYTES,
  },
  video: {
    allowed: new Set(["video/mp4", "video/webm"]),
    maxBytes: MAX_VIDEO_BYTES,
  },
  image: {
    allowed: new Set(["image/png", "image/jpeg", "image/webp"]),
    maxBytes: MAX_IMAGE_BYTES,
  },
  log: {
    allowed: new Set([
      "text/plain",
      "application/json",
      "application/x-ndjson",
    ]),
    maxBytes: MAX_LOG_BYTES,
  },
};

const executableExtensions = new Set([
  "app",
  "bat",
  "bin",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "gadget",
  "hta",
  "iso",
  "jar",
  "js",
  "jse",
  "lnk",
  "msi",
  "msp",
  "pif",
  "ps1",
  "reg",
  "scr",
  "sh",
  "sys",
  "vb",
  "vbe",
  "vbs",
  "ws",
  "wsf",
]);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reasoningPattern = /^[\p{L}\p{N} ._:+/-]{1,40}$/u;
const harnessPattern = /^[\p{L}\p{N} ._:+/()-]{1,80}$/u;

export const showcaseDraftSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    summary: z.string().trim().min(24).max(800),
    category: z.enum(["frontend", "browser-game", "browser-3d", "other"]),
    modelLabel: z.string().trim().min(2).max(100),
    harness: z.string().trim().regex(harnessPattern),
    reasoningLevel: z.string().trim().regex(reasoningPattern),
    prompt: z.string().trim().min(1).max(40_000),
    systemPrompt: z.string().trim().max(20_000).optional().default(""),
    sourceVisibility: z.enum(["public", "private"]).default("public"),
    rightsConfirmed: z.literal(true),
  })
  .strict();

export const artifactIntentSchema = z
  .object({
    kind: z.enum(artifactKinds),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.string().trim().min(1).max(120),
    byteSize: z.number().int().positive(),
  })
  .strict();

export const abuseReportSchema = z
  .object({
    url: z.string().trim().min(1).max(500),
    reason: z.enum([
      "malware",
      "copyright",
      "fraud",
      "harassment",
      "other",
    ]),
    details: z.string().trim().min(10).max(2000),
  })
  .strict();

export function parseShowcaseSlug(value: string): string | null {
  if (containsControlCharacters(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://benchmax.invalid");
  } catch {
    return null;
  }
  const match = /^\/showcases\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u.exec(
    parsed.pathname,
  );
  return match?.[1] ?? null;
}

export function parseReportTarget(
  value: string,
): { kind: "showcase" | "run"; slug: string } | null {
  if (containsControlCharacters(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://benchmax.invalid");
  } catch {
    return null;
  }
  const showcase = /^\/showcases\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u.exec(
    parsed.pathname,
  );
  if (showcase) return { kind: "showcase", slug: showcase[1] };
  const run = /^\/runs\/(run-[a-z0-9-]+)\/?$/u.exec(parsed.pathname);
  if (run) return { kind: "run", slug: run[1] };
  return null;
}

export function validateArtifactIntent(input: unknown) {
  const parsed = artifactIntentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid upload metadata." };
  }

  const fileName = normalizeUploadFilename(parsed.data.fileName);
  if (!fileName) {
    return { ok: false as const, error: "Unsafe or unsupported filename." };
  }

  const policy = mimePolicy[parsed.data.kind];
  const contentType = parsed.data.contentType.toLowerCase();
  if (!policy.allowed.has(contentType)) {
    return {
      ok: false as const,
      error: `Unsupported ${parsed.data.kind} file type.`,
    };
  }
  if (parsed.data.byteSize > policy.maxBytes) {
    return {
      ok: false as const,
      error: `${parsed.data.kind} exceeds its upload limit.`,
    };
  }

  return {
    ok: true as const,
    value: { ...parsed.data, fileName, contentType },
  };
}

export function normalizeUploadFilename(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    /%2f|%5c/i.test(normalized)
  ) {
    return null;
  }

  const extension = normalized.includes(".")
    ? normalized.split(".").pop()?.toLowerCase()
    : undefined;
  if (extension && executableExtensions.has(extension)) return null;

  return normalized;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slugPattern.test(slug) ? slug : "test-report";
}

const secretPatterns: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: "generic credential assignment",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"'\n]{12,}["']/gi,
  },
];

export function detectSecretLabels(value: string): string[] {
  const labels = new Set<string>();
  for (const { label, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) labels.add(label);
  }
  return [...labels];
}

export function containsControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const input =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (
    left.length !== right.length ||
    !/^[a-f0-9]+$/i.test(left) ||
    !/^[a-f0-9]+$/i.test(right)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
