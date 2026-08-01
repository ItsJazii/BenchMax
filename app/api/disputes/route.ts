import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { createDispute } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { disputeCreateSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requestDisputeRejudgment } from "@/lib/data/dispute-rejudge";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "dispute-create",
      limit: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, disputeCreateSchema);
    const dispute = await createDispute(user.id, input);
    const rejudgment = await requestDisputeRejudgment({
      actorUserId: user.id,
      disputeId: dispute.id,
      runId: dispute.runId,
    });
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "dispute",
      entityId: dispute.id,
      action: "dispute.opened",
      metadata: { rejudgmentStatus: rejudgment.status, runId: dispute.runId },
    });
    return secureJson({ dispute, rejudgment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
