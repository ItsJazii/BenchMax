import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { approveCommunityTest } from "@/lib/data/community-tests";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuthorizedUser(request);
    const { id } = await context.params;
    const test = await approveCommunityTest(id, user.id);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "community-test",
      entityId: id,
      action: "community_test.published",
    });
    return secureJson({ test });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
