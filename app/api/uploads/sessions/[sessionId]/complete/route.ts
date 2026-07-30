import { env } from "cloudflare:workers";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  finalizeUploadedArtifact,
  getOwnedUploadSession,
  promoteUploadSessionObjectKey,
} from "@/lib/data/uploads";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { scanQuarantinedArtifact } from "@/lib/security/artifact-scanner";
import { uploadObjectKeys } from "@/lib/storage/upload-keys";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "upload-complete",
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { sessionId } = await context.params;
    const session = await getOwnedUploadSession(sessionId, user.id);
    if (!session) {
      return secureJson({ error: "Upload session not found." }, { status: 404 });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return secureJson({ error: "Upload session expired." }, { status: 409 });
    }

    const object = await env.UPLOADS.head(session.objectKey);
    if (!object) {
      return secureJson(
        { error: "Uploaded object was not found." },
        { status: 409 },
      );
    }
    const uploadedContentType = object.httpMetadata?.contentType;
    const sessionMarker = object.customMetadata?.benchmaxSession;
    const isPromotedEvidence =
      object.customMetadata?.immutableEvidence === "true";
    if (
      object.size !== session.expectedBytes ||
      uploadedContentType !== session.contentType ||
      sessionMarker !== session.id ||
      (session.objectKey.startsWith("evidence/") && !isPromotedEvidence)
    ) {
      await env.UPLOADS.delete(session.objectKey);
      return secureJson(
        { error: "Upload integrity verification failed." },
        { status: 400 },
      );
    }

    const finalObjectKey = uploadObjectKeys({
      fileName: session.fileName,
      sessionId: session.id,
      userId: session.userId,
    }).evidence;
    if (session.objectKey !== finalObjectKey) {
      const quarantined = await env.UPLOADS.get(session.objectKey);
      if (!quarantined) {
        return secureJson(
          { error: "Uploaded object was not found." },
          { status: 409 },
        );
      }
      await env.UPLOADS.put(finalObjectKey, quarantined.body, {
        httpMetadata: { contentType: session.contentType },
        customMetadata: {
          benchmaxSession: session.id,
          immutableEvidence: "true",
        },
      });
      const promoted = await env.UPLOADS.head(finalObjectKey);
      if (
        !promoted ||
        promoted.size !== session.expectedBytes ||
        promoted.httpMetadata?.contentType !== session.contentType ||
        promoted.customMetadata?.benchmaxSession !== session.id ||
        promoted.customMetadata?.immutableEvidence !== "true"
      ) {
        await env.UPLOADS.delete(finalObjectKey);
        return secureJson(
          { error: "Upload promotion integrity verification failed." },
          { status: 500 },
        );
      }
      await promoteUploadSessionObjectKey({
        finalObjectKey,
        quarantineObjectKey: session.objectKey,
        sessionId: session.id,
      });
      await env.UPLOADS.delete(session.objectKey);
    }

    const artifact = await finalizeUploadedArtifact({ sessionId: session.id });
    const scan = await scanQuarantinedArtifact(artifact);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "artifact",
      entityId: artifact.id,
      action:
        scan.status === "approved"
          ? "artifact.scan_approved"
          : scan.status === "blocked"
            ? "artifact.scan_blocked"
            : "artifact.scan_pending",
      metadata: {
        kind: artifact.kind,
        byteSize: artifact.byteSize,
        scanStatus: scan.status,
      },
    });
    return secureJson({
      artifact: {
        id: artifact.id,
        fileName: artifact.fileName,
        kind: artifact.kind,
        quarantineStatus: scan.status,
        findings: scan.findings,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
