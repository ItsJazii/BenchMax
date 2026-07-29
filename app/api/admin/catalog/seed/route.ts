import { requireAuthorizedUser, requireRole } from "@/lib/auth/authorization";
import { seedRankedCatalog } from "@/lib/data/catalog-admin";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    await enforceRateLimit(identity.subject, {
      action: "catalog-seed",
      limit: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const result = await seedRankedCatalog();
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "catalog",
      entityId: "ranked-v1",
      action: "catalog.seeded",
      metadata: result,
    });
    return secureJson({ catalog: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
