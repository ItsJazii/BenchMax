import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { applyModerationAction } from "@/lib/data/community";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { moderationActionSchema } from "@/lib/security/community";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  enqueueResultRankingRefresh,
  findResultRunIdForShowcase,
} from "@/lib/data/result-supersession";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner", "moderator"]);
    await enforceRateLimit(identity.subject, {
      action: "moderation-action",
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, moderationActionSchema);
    const result = await applyModerationAction(user.id, input);
    let publishRefreshDeferred = false;
    const refreshRunId =
      input.entityType === "run"
        ? input.entityId
        : input.entityType === "showcase"
          ? await findResultRunIdForShowcase(input.entityId)
          : null;
    if (refreshRunId) {
      await enqueueResultRankingRefresh(
        refreshRunId,
        `moderation-${input.action}`,
      ).catch((error: unknown) => {
        publishRefreshDeferred = true;
        console.error("Moderated run publish refresh was deferred", {
          name: error instanceof Error ? error.name : "UnknownError",
          runId: refreshRunId,
        });
      });
    }
    if (publishRefreshDeferred) {
      await appendAuditEvent({
        actorUserId: user.id,
        entityType: "run",
        entityId: refreshRunId ?? input.entityId,
        action: "run.publish_refresh_deferred",
        metadata: { moderationAction: input.action, stage: "publish" },
      });
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: input.entityType,
      entityId: input.entityId,
      action: `moderation.${input.action}`,
      metadata: { moderationResult: result },
    });
    return secureJson({ result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
