import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { resolveDispute } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { disputeResolutionSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";
import { requestDisputeRejudgment } from "@/lib/data/dispute-rejudge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner", "moderator"]);
    await enforceRateLimit(identity.subject, {
      action: "dispute-review",
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const input = await parseJson(request, disputeResolutionSchema);
    const dispute = await resolveDispute(user.id, id, input);
    const rejudgment =
      input.status === "resolved"
        ? await requestDisputeRejudgment({
            actorUserId: user.id,
            disputeId: dispute.id,
            runId: dispute.runId,
          })
        : { status: "not-requested" as const };
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "dispute",
      entityId: id,
      action: `dispute.${input.status}`,
      metadata: { rejudgmentStatus: rejudgment.status, runId: dispute.runId },
    });
    return secureJson({ dispute, rejudgment });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
