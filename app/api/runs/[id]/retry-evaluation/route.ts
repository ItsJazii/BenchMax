import { env } from "cloudflare:workers";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { getOwnedRun, transitionRun } from "@/lib/data/runs";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "run-evaluation-retry",
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const run = await getOwnedRun(id, user.id);
    if (!run || run.status !== "evaluation_failed") {
      return secureJson(
        { error: "A retryable evaluation was not found." },
        { status: 404 },
      );
    }
    const queued = await transitionRun({
      id: run.id,
      from: "evaluation_failed",
      to: "queued_evaluation",
      patch: { failureCode: null, failureSummary: null },
    });
    try {
      await env.EVALUATE_QUEUE.send({
        runId: run.id,
        stage: "evaluate",
        stageVersion: "1",
      });
    } catch {
      await transitionRun({
        id: run.id,
        from: "queued_evaluation",
        to: "evaluation_failed",
        patch: {
          failureCode: "evaluation_queue_unavailable",
          failureSummary: "Evaluation could not be re-queued.",
        },
      });
      throw new EvaluationRetryUnavailableError();
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "run",
      entityId: run.id,
      action: "run.evaluation_requeued",
      metadata: { generationKeyRequired: false },
    });
    return secureJson({ run: queued }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

class EvaluationRetryUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super("Evaluation could not be re-queued.");
    this.name = "EvaluationRetryUnavailableError";
  }
}
