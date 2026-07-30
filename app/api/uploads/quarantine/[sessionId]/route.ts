import { env } from "cloudflare:workers";
import {
  getUploadSession,
  markSessionUploading,
  releaseSessionUploadClaim,
} from "@/lib/data/uploads";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import {
  constantTimeEqualHex,
  sha256Hex,
} from "@/lib/security/policy";

export async function PUT(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const session = await getUploadSession(sessionId);
    if (!session) {
      return secureJson({ error: "Upload session not found." }, { status: 404 });
    }
    if (
      session.status !== "created" ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return secureJson(
        { error: "Upload session is no longer active." },
        { status: 409 },
      );
    }

    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const digest = token ? await sha256Hex(token) : "";
    if (!constantTimeEqualHex(digest, session.tokenDigest)) {
      return secureJson({ error: "Invalid upload token." }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== session.expectedBytes
    ) {
      return secureJson(
        { error: "Uploaded size does not match the declared size." },
        { status: 400 },
      );
    }
    const contentType = request.headers.get("content-type")?.split(";")[0].trim();
    if (contentType !== session.contentType) {
      return secureJson(
        { error: "Uploaded type does not match the declared type." },
        { status: 400 },
      );
    }
    if (!request.body) {
      return secureJson({ error: "Upload body is required." }, { status: 400 });
    }

    if (!(await markSessionUploading(session.id))) {
      return secureJson(
        { error: "Upload session is already in use." },
        { status: 409 },
      );
    }
    try {
      await env.UPLOADS.put(session.objectKey, request.body, {
        httpMetadata: { contentType: session.contentType },
        customMetadata: { benchmaxSession: session.id },
      });
    } catch (error) {
      await releaseSessionUploadClaim(session.id).catch(() => undefined);
      throw error;
    }
    return secureJson({ uploaded: true, sessionId: session.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
