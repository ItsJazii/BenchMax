import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { publishShowcase } from "@/lib/data/showcases";
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
      action: "showcase-publish",
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const showcase = await publishShowcase(id, user.id);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "showcase",
      entityId: showcase.id,
      action: "showcase.published",
    });
    return secureJson({ showcase });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
