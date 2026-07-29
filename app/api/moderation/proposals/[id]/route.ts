import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { reviewBenchmarkProposal } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { proposalReviewSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    const { id } = await context.params;
    const input = await parseJson(request, proposalReviewSchema);
    const proposal = await reviewBenchmarkProposal(user.id, id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "benchmark-proposal",
      entityId: id,
      action: `benchmark_proposal.${input.status}`,
      metadata: { category: proposal.category },
    });
    return secureJson({ proposal });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
