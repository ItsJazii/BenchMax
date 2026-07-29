import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { writeBackupManifest } from "@/lib/data/operations";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    await enforceRateLimit(identity.subject, {
      action: "backup-manifest",
      limit: 4,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const manifest = await writeBackupManifest(user.id);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "backup-manifest",
      entityId: manifest.sha256,
      action: "backup.manifest_created",
      metadata: { objectKey: manifest.objectKey },
    });
    return secureJson({ manifest }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
