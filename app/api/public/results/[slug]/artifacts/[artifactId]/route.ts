import { publicSecurityHeaders } from "@/lib/security/http";
import { buildResultArtifactUrl } from "@/lib/security/usercontent";

const ARTIFACT_PATH =
  /^\/api\/public\/results\/([a-z0-9]+(?:-[a-z0-9]+)*)\/artifacts\/([0-9a-f-]{36})$/;

export async function GET(request: Request) {
  return redirectArtifact(request);
}

export async function HEAD(request: Request) {
  return redirectArtifact(request);
}

function redirectArtifact(request: Request): Response {
  const match = ARTIFACT_PATH.exec(new URL(request.url).pathname);
  if (!match) return safeText("Not found.", 404);

  try {
    const target = buildResultArtifactUrl(match[1], match[2]);
    if (new URL(target).origin === new URL(request.url).origin) {
      return safeText("User-content origin unavailable.", 503);
    }
    const headers = publicSecurityHeaders();
    headers.set("Cache-Control", "no-store");
    headers.set("Location", target);
    return new Response(null, { status: 307, headers });
  } catch {
    return safeText("User-content origin unavailable.", 503);
  }
}

function safeText(message: string, status: number): Response {
  const headers = publicSecurityHeaders();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(message, { headers, status });
}
