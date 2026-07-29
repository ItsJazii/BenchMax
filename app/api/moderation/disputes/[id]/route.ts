import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { resolveDispute } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { disputeResolutionSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner", "moderator"]);
    const { id } = await context.params;
    const input = await parseJson(request, disputeResolutionSchema);
    const dispute = await resolveDispute(user.id, id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "dispute",
      entityId: id,
      action: `dispute.${input.status}`,
      metadata: { runId: dispute.runId },
    });
    return secureJson({ dispute });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
