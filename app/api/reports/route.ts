import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { createAbuseReport } from "@/lib/data/reports";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { abuseReportSchema } from "@/lib/security/policy";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "abuse-report-create",
      limit: 5,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, abuseReportSchema);
    const report = await createAbuseReport(user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "abuse_report",
      entityId: report.id,
      action: "abuse_report.created",
      metadata: { reason: input.reason },
    });
    return secureJson({ report }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
