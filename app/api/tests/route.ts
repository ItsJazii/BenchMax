import { requireAuthorizedUser } from "@/lib/auth/authorization";
import {
  createCommunityTest,
  listCommunityTests,
} from "@/lib/data/community-tests";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { communityTestDraftSchema } from "@/lib/security/policy";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { secureJson } from "@/lib/security/http";

export async function GET() {
  try {
    return secureJson({ tests: await listCommunityTests() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "community-test-create",
      limit: 10,
      windowMs: 30 * 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, communityTestDraftSchema);
    const test = await createCommunityTest(user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "community-test",
      entityId: test.id,
      action: "community_test.rubric_drafted",
      metadata: { versionId: test.versionId },
    });
    return secureJson({ test }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
