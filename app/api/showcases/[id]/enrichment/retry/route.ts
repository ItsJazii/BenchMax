import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { retryShowcaseEnrichment } from "@/lib/data/showcase-enrichment";
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
      action: "showcase-enrichment-retry",
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const retry = await retryShowcaseEnrichment(id, user.id);
    if (!retry) {
      return secureJson(
        { error: "No failed automated preview is available to retry." },
        { status: 409 },
      );
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "showcase",
      entityId: id,
      action: "showcase.enrichment_retried",
      metadata: { dispatchDeferred: retry.dispatchDeferred },
    });
    return secureJson({ retry });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
