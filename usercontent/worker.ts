import { unzipSync } from "fflate";

interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  BENCHMAX_APP_ORIGIN: string;
}

const RUN_PATH = /^\/run\/([0-9a-f-]{36})\/(.+)$/i;

const usercontentWorker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return isolatedResponse("Method not allowed.", 405, env);
    }
    const url = new URL(request.url);
    const match = RUN_PATH.exec(url.pathname);
    if (!match) return isolatedResponse("Not found.", 404, env);
    const runId = match[1];
    const path = normalizeUsercontentPath(match[2]);
    if (!path) return isolatedResponse("Not found.", 404, env);

    const row = await env.DB.prepare(
      `SELECT ra.object_key
       FROM runs r
       JOIN run_artifacts ra ON ra.run_id = r.id
       WHERE r.id = ?
         AND r.status = 'published'
         AND r.playable_enabled = 1
         AND ra.kind = 'generated-source'
       LIMIT 1`,
    )
      .bind(runId)
      .first<{ object_key: string }>();
    if (!row) return isolatedResponse("Not found.", 404, env);
    const archive = await env.UPLOADS.get(row.object_key);
    if (!archive) return isolatedResponse("Not found.", 404, env);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const body = files[path];
    if (!body) return isolatedResponse("Not found.", 404, env);

    const headers = isolatedHeaders(env);
    headers.set("Content-Type", contentType(path));
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable, no-transform",
    );
    headers.set("ETag", `"${runId}:${path}"`);
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers,
    });
  },
};

export default usercontentWorker;

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

function isolatedResponse(body: string, status: number, env: Env) {
  const headers = isolatedHeaders(env);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

function isolatedHeaders(env: Env) {
  return buildUsercontentHeaders(env.BENCHMAX_APP_ORIGIN);
}

export function buildUsercontentHeaders(appOriginValue: string | undefined) {
  const appOrigin = safeHttpsOrigin(appOriginValue);
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

function safeHttpsOrigin(value: string | undefined) {
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
