import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  createCommunityTestVersion,
  getCommunityTestDraft,
} from "@/lib/data/community-tests";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { communityTestDraftSchema } from "@/lib/security/policy";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { secureJson } from "@/lib/security/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuthorizedUser(request);
    const { id } = await context.params;
    return secureJson({ test: await getCommunityTestDraft(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    const { id } = await context.params;
    const input = await parseJson(request, communityTestDraftSchema);
    await enforceRateLimit(identity.subject, {
      action: "community-test-version-create",
      limit: 10,
      windowMs: 30 * 24 * 60 * 60 * 1000,
    });
    await enforceRateLimit("benchmax-global-rubric-drafting", {
      action: "community-test-rubric-draft-global",
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const test = await createCommunityTestVersion(id, user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "community-test",
      entityId: id,
      action: "community_test.version_drafted",
      metadata: {
        version: test.version,
        versionId: test.versionId,
        ...test.rubricDraft,
      },
    });
    return secureJson({ test }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
