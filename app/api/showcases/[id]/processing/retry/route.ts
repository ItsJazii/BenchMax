import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { retryShowcaseProcessing } from "@/lib/data/showcase-processing";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "showcase-processing-retry",
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const processing = await retryShowcaseProcessing(id, user.id);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "showcase",
      entityId: id,
      action:
        processing.outcome === "ready"
          ? "showcase.processing_retry_completed"
          : processing.outcome === "blocked"
            ? "showcase.processing_retry_blocked"
            : "showcase.processing_retry_pending",
      metadata: {
        outcome: processing.outcome,
        scannedArtifactCount: processing.scannedArtifactIds.length,
      },
    });
    return secureJson({ processing });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
