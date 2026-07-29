import { showcaseDraftSchema } from "@/lib/security/policy";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import {
  createShowcaseDraft,
  listPublicShowcases,
} from "@/lib/data/showcases";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse, parseJson } from "@/lib/http/api";

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 24);
    const rows = await listPublicShowcases(Number.isFinite(limit) ? limit : 24);
    return secureJson({ showcases: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "showcase-create",
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, showcaseDraftSchema);
    const showcase = await createShowcaseDraft(user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "showcase",
      entityId: showcase.id,
      action: "showcase.draft_created",
      metadata: { category: showcase.category },
    });
    return secureJson({ showcase }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
