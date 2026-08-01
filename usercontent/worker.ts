import {
  isLegacyRunSlug,
  isResultSlug,
  isUuid,
  parseHttpsOrigin,
} from "../lib/security/usercontent";
import { readBoundedZipEntry } from "../lib/security/bounded-zip";

export interface UsercontentEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  BENCHMAX_APP_ORIGIN: string;
}

type ArtifactRow = {
  object_key: string;
  kind: string;
  content_type: string;
  byte_size: number;
  sha256: string;
};

const PLAYABLE_PATH = /^\/run\/([0-9a-f-]{36})\/(.+)$/i;
const RESULT_ARTIFACT_PATH =
  /^\/results\/([a-z0-9]+(?:-[a-z0-9]+)*)\/artifacts\/([0-9a-f-]{36})$/;
const LEGACY_ARTIFACT_PATH =
  /^\/runs\/(run-[0-9a-f]{12})\/artifacts\/([0-9a-f-]{36})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const RESULT_CONTENT_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  source: new Set([
    "application/zip",
    "application/x-zip-compressed",
    "text/plain",
  ]),
  video: new Set(["video/mp4", "video/webm"]),
  image: new Set(["image/png", "image/jpeg", "image/webp"]),
  log: new Set([
    "text/plain",
    "application/json",
    "application/x-ndjson",
  ]),
};

const LEGACY_CONTENT_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  "generated-source": new Set([
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ]),
  "build-log": new Set([
    "text/plain",
    "text/plain; charset=utf-8",
    "application/octet-stream",
  ]),
  "run-log": new Set([
    "text/plain",
    "text/plain; charset=utf-8",
    "application/octet-stream",
  ]),
  screenshot: new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/octet-stream",
  ]),
  video: new Set([
    "video/mp4",
    "video/webm",
    "application/octet-stream",
  ]),
  bundle: new Set([
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ]),
  "evaluation-report": new Set([
    "application/json",
    "application/octet-stream",
  ]),
};

export const usercontentWorker = {
  async fetch(request: Request, env: UsercontentEnv): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      const response = isolatedResponse("Method not allowed.", 405);
      response.headers.set("Allow", "GET, HEAD");
      return response;
    }

    const pathname = new URL(request.url).pathname;
    const resultMatch = RESULT_ARTIFACT_PATH.exec(pathname);
    if (resultMatch) {
      const [, slug, artifactId] = resultMatch;
      if (!isResultSlug(slug) || !isUuid(artifactId)) {
        return isolatedResponse("Not found.", 404);
      }
      return serveResultArtifact(request, env, slug, artifactId);
    }

    const legacyMatch = LEGACY_ARTIFACT_PATH.exec(pathname);
    if (legacyMatch) {
      const [, slug, artifactId] = legacyMatch;
      if (!isLegacyRunSlug(slug) || !isUuid(artifactId)) {
        return isolatedResponse("Not found.", 404);
      }
      return serveLegacyArtifact(request, env, slug, artifactId);
    }

    const playableMatch = PLAYABLE_PATH.exec(pathname);
    if (playableMatch) {
      return serveLegacyPlayable(
        request,
        env,
        playableMatch[1],
        playableMatch[2],
      );
    }

    return isolatedResponse("Not found.", 404);
  },
};

export default usercontentWorker;

async function serveResultArtifact(
  request: Request,
  env: UsercontentEnv,
  slug: string,
  artifactId: string,
): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         a.object_key,
         a.kind,
         a.content_type,
         a.byte_size,
         a.sha256
       FROM showcases s
       JOIN artifacts a ON a.showcase_id = s.id
       WHERE s.slug = ?
         AND s.status = 'published'
         AND s.safety_status = 'approved'
         AND a.id = ?
         AND a.quarantine_status = 'approved'
         AND a.sha256 IS NOT NULL
         AND (a.kind != 'source' OR s.source_visibility = 'public')
       LIMIT 1`,
    )
      .bind(slug, artifactId)
      .first<ArtifactRow>();
    if (!row || !RESULT_CONTENT_TYPES[row.kind]?.has(row.content_type)) {
      return isolatedResponse("Not found.", 404);
    }
    return await serveStoredArtifact(request, env, row);
  } catch {
    return isolatedResponse("Not found.", 404);
  }
}

async function serveLegacyArtifact(
  request: Request,
  env: UsercontentEnv,
  slug: string,
  artifactId: string,
): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         ra.object_key,
         ra.kind,
         ra.content_type,
         ra.byte_size,
         ra.sha256
       FROM runs r
       JOIN run_artifacts ra ON ra.run_id = r.id
       WHERE r.public_slug = ?
         AND r.status = 'published'
         AND r.credential_mode != 'community-submission'
         AND ra.id = ?
         AND ra.public = 1
       LIMIT 1`,
    )
      .bind(slug, artifactId)
      .first<ArtifactRow>();
    if (!row || !LEGACY_CONTENT_TYPES[row.kind]?.has(row.content_type)) {
      return isolatedResponse("Not found.", 404);
    }
    return await serveStoredArtifact(request, env, row);
  } catch {
    return isolatedResponse("Not found.", 404);
  }
}

async function serveStoredArtifact(
  request: Request,
  env: UsercontentEnv,
  row: ArtifactRow,
): Promise<Response> {
  if (
    !Number.isSafeInteger(row.byte_size) ||
    row.byte_size <= 0 ||
    !SHA256_PATTERN.test(row.sha256)
  ) {
    return isolatedResponse("Not found.", 404);
  }
  const object = await env.UPLOADS.get(row.object_key);
  if (
    !object ||
    object.size !== row.byte_size ||
    object.httpMetadata?.contentType !== row.content_type
  ) {
    return isolatedResponse("Not found.", 404);
  }

  const headers = artifactHeaders();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", contentDisposition(row));
  headers.set("Content-Length", String(row.byte_size));
  headers.set("Content-Type", row.content_type);
  headers.set("ETag", `"${row.sha256}"`);
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}

async function serveLegacyPlayable(
  request: Request,
  env: UsercontentEnv,
  runId: string,
  pathValue: string,
): Promise<Response> {
  if (!isUuid(runId)) return isolatedResponse("Not found.", 404);
  const path = normalizeUsercontentPath(pathValue);
  if (!path) return isolatedResponse("Not found.", 404);

  try {
    const row = await env.DB.prepare(
      `SELECT
         ra.object_key,
         ra.content_type,
         ra.byte_size,
         ra.sha256
       FROM runs r
       JOIN run_artifacts ra ON ra.run_id = r.id
       WHERE r.id = ?
         AND r.status = 'published'
         AND r.credential_mode != 'community-submission'
         AND r.playable_enabled = 1
         AND ra.kind = 'generated-source'
         AND ra.public = 1
       LIMIT 1`,
    )
      .bind(runId)
      .first<{
        object_key: string;
        content_type: string;
        byte_size: number;
        sha256: string;
      }>();
    if (!row || !SHA256_PATTERN.test(row.sha256)) {
      return isolatedResponse("Not found.", 404);
    }
    const archive = await env.UPLOADS.get(row.object_key);
    if (
      !archive ||
      archive.size !== row.byte_size ||
      archive.httpMetadata?.contentType !== row.content_type
    ) {
      return isolatedResponse("Not found.", 404);
    }
    const body = readBoundedZipEntry(
      new Uint8Array(await archive.arrayBuffer()),
      path,
    );
    if (!body) return isolatedResponse("Not found.", 404);

    const headers = buildUsercontentHeaders(env.BENCHMAX_APP_ORIGIN);
    headers.set("Content-Type", contentType(path));
    headers.set("Cache-Control", "no-store");
    headers.set("ETag", `"${row.sha256}:${path}"`);
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers,
    });
  } catch {
    return isolatedResponse("Not found.", 404);
  }
}

export function normalizeUsercontentPath(value: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value).normalize("NFKC").replaceAll("\\", "/");
  } catch {
    return null;
  }
  const parts = decoded.split("/");
  if (
    decoded.startsWith("/") ||
    /^[a-zA-Z]:/.test(decoded) ||
    decoded.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    /[\u0000-\u001f\u007f]/u.test(decoded)
  ) {
    return null;
  }
  return parts.join("/");
}

function isolatedResponse(body: string, status: number) {
  const headers = artifactHeaders();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

function artifactHeaders() {
  return new Headers({
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

export function buildUsercontentHeaders(appOriginValue: string | undefined) {
  const appOrigin = parseHttpsOrigin(appOriginValue);
  const headers = new Headers({
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${appOrigin ?? "'none'"}`,
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
    ].join("; "),
  );
  return headers;
}

function contentDisposition(row: ArtifactRow): string {
  const inline =
    row.content_type.startsWith("image/") ||
    row.content_type.startsWith("video/");
  const safeKind = row.kind.replace(/[^a-z0-9-]/g, "-").slice(0, 32);
  const filename = `benchmax-${safeKind}-${row.sha256.slice(0, 12)}${extensionFor(row.content_type)}`;
  return `${inline ? "inline" : "attachment"}; filename="${filename}"`;
}

function extensionFor(value: string): string {
  const extensions: Record<string, string> = {
    "application/json": ".json",
    "application/x-ndjson": ".ndjson",
    "application/x-zip-compressed": ".zip",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "text/plain; charset=utf-8": ".txt",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return extensions[value] ?? ".bin";
}

function contentType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    html: "text/html; charset=utf-8",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    webp: "image/webp",
  };
  return types[extension ?? ""] ?? "application/octet-stream";
}
