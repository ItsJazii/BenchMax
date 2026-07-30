import { z } from "zod";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { createUploadSession } from "@/lib/data/uploads";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import {
  artifactIntentSchema,
  validateArtifactIntent,
} from "@/lib/security/policy";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createR2PresignedUpload } from "@/lib/storage/r2-presign";

const requestSchema = artifactIntentSchema
  .extend({ showcaseId: z.string().uuid() })
  .strict();

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "upload-session-create",
      limit: 50,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, requestSchema);
    const validated = validateArtifactIntent(input);
    if (!validated.ok) {
      return secureJson({ error: validated.error }, { status: 400 });
    }

    const { session, token } = await createUploadSession({
      showcaseId: input.showcaseId,
      user,
      kind: validated.value.kind,
      fileName: validated.value.fileName,
      contentType: validated.value.contentType,
      byteSize: validated.value.byteSize,
    });
    const directTarget = await createR2PresignedUpload({
      byteSize: session.expectedBytes,
      contentType: session.contentType,
      objectKey: session.objectKey,
      sessionId: session.id,
    });
    const fallbackUrl = `/api/uploads/quarantine/${session.id}`;
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "upload_session",
      entityId: session.id,
      action: "upload_session.created",
      metadata: {
        kind: session.artifactKind,
        byteSize: session.expectedBytes,
        transport: directTarget ? "presigned-r2" : "worker-quarantine",
      },
    });

    return secureJson(
      {
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
          token,
          upload: directTarget ?? {
            mode: "worker-quarantine",
            method: "PUT",
            url: fallbackUrl,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": session.contentType,
            },
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
