import { env } from "cloudflare:workers";
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
    if (input.entityType === "run" && input.action === "dismiss") {
      await env.JUDGE_QUEUE.send({
        runId: input.entityId,
        stage: "publish",
        stageVersion: "1",
      }).catch((error: unknown) => {
        publishRefreshDeferred = true;
        console.error("Moderated run publish refresh was deferred", {
          name: error instanceof Error ? error.name : "UnknownError",
          runId: input.entityId,
        });
      });
    }
    if (publishRefreshDeferred) {
      await appendAuditEvent({
        actorUserId: user.id,
        entityType: "run",
        entityId: input.entityId,
        action: "run.publish_refresh_deferred",
        metadata: { stage: "publish", stageVersion: "1" },
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
