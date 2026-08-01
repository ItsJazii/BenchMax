import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  getShowcaseForOwner,
  publishShowcase,
} from "@/lib/data/showcases";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { verifyApprovedShowcaseArtifacts } from "@/lib/security/artifact-scanner";
import { queuePublishedResult } from "@/lib/data/results";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "showcase-publish",
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const draft = await getShowcaseForOwner(id, user.id);
    if (!draft || draft.status !== "draft") {
      return secureJson(
        { error: "Showcase draft not found." },
        { status: 404 },
      );
    }
    await verifyApprovedShowcaseArtifacts(id);
    const showcase = await publishShowcase(id, user.id);
    let run: Awaited<ReturnType<typeof queuePublishedResult>>["run"] | null =
      null;
    let judgeQueueDeferred = false;
    try {
      const queued = await queuePublishedResult(showcase.id);
      run = queued.run;
      judgeQueueDeferred = queued.judgeQueueDeferred;
    } catch {
      judgeQueueDeferred = true;
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "showcase",
      entityId: showcase.id,
      action: "showcase.published",
      metadata: { judgeQueueDeferred },
    });
    return secureJson(
      { showcase, run, judgeQueueDeferred },
      { status: judgeQueueDeferred ? 202 : 200 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
