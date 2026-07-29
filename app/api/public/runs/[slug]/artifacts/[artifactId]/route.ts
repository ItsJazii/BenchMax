import { env } from "cloudflare:workers";
import { getPublicRunArtifact } from "@/lib/data/runs";
import { publicSecurityHeaders } from "@/lib/security/http";

export async function GET(request: Request) {
  return serveArtifact(request, false);
}

export async function HEAD(request: Request) {
  return serveArtifact(request, true);
}

async function serveArtifact(request: Request, head: boolean) {
  const match =
    /^\/api\/public\/runs\/(run-[0-9a-f]{12})\/artifacts\/([0-9a-f-]{36})$/i.exec(
      new URL(request.url).pathname,
    );
  if (!match) return safeText("Not found.", 404);
  const [, slug, artifactId] = match;
  const artifact = await getPublicRunArtifact(slug, artifactId);
  if (!artifact) return safeText("Not found.", 404);
  const object = await env.UPLOADS.get(artifact.objectKey);
  if (!object) return safeText("Not found.", 404);

  const headers = publicSecurityHeaders();
  headers.set("Cache-Control", "public, max-age=31536000, immutable, no-transform");
  headers.set(
    "Content-Disposition",
    `attachment; filename="benchmax-${artifact.kind}-${artifact.sha256.slice(0, 12)}${extensionFor(artifact.kind)}"`,
  );
  headers.set("Content-Length", String(artifact.byteSize));
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("ETag", `"${artifact.sha256}"`);
  return new Response(head ? null : object.body, { headers });
}

function safeText(message: string, status: number) {
  const headers = publicSecurityHeaders();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(message, { headers, status });
}

function extensionFor(kind: string) {
  if (kind === "generated-source" || kind === "bundle") return ".zip";
  if (kind === "screenshot") return ".png";
  if (kind === "video") return ".webm";
  if (kind === "evaluation-report") return ".json";
  return ".txt";
}
