import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { createBenchmarkProposal } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { benchmarkProposalSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "benchmark-proposal",
      limit: 3,
      windowMs: 7 * 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, benchmarkProposalSchema);
    const proposal = await createBenchmarkProposal(user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "benchmark-proposal",
      entityId: proposal.id,
      action: "benchmark_proposal.submitted",
      metadata: { category: proposal.category },
    });
    return secureJson({ proposal }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
