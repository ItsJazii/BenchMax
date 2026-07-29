import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  createRunDraft,
  listRunsForOwner,
} from "@/lib/data/runs";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { runDraftSchema } from "@/lib/security/run-policy";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    return secureJson({ runs: await listRunsForOwner(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "run-draft-create",
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, runDraftSchema);
    const run = await createRunDraft(user.id, input);
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "run",
      entityId: run.id,
      action: "run.draft_created",
      metadata: {
        benchmarkVersionId: run.benchmarkVersionId,
        configurationId: run.configurationId,
        credentialMode: run.credentialMode,
      },
    });
    return secureJson({ run }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
