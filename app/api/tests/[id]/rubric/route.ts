import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { updateCommunityTestRubric } from "@/lib/data/community-tests";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { rubricDraftSchema } from "@/lib/judging/rubric-draft";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { secureJson } from "@/lib/security/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    const { id } = await context.params;
    const input = await parseJson(request, rubricDraftSchema);
    await enforceRateLimit(identity.subject, {
      action: "community-test-rubric-edit",
      limit: 30,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const test = await updateCommunityTestRubric(id, user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "community-test",
      entityId: id,
      action: "community_test.rubric_updated",
      metadata: {
        dimensionCount: test.rubric.length,
        version: test.version,
        versionId: test.versionId,
      },
    });
    return secureJson({ test });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
