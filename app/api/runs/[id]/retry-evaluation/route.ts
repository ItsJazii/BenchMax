import { env } from "cloudflare:workers";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { getOwnedRun, transitionRun } from "@/lib/data/runs";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  findLatestFailedPipelineStage,
  manualRetryPlan,
} from "@/lib/pipeline/recovery";
import { getDb } from "@/db";
import { showcases } from "@/db/schema";
import { eq } from "drizzle-orm";

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
    const failedStage = await findLatestFailedPipelineStage(env.DB, run.id);
    const retry = manualRetryPlan(failedStage, {
      alreadyScored: run.overallScoreBps !== null,
    });
    const queued = await transitionRun({
      id: run.id,
      from: "evaluation_failed",
      to: retry.targetStatus,
      patch: { failureCode: null, failureSummary: null },
    });
    try {
      const queue =
        retry.queue === "evaluate" ? env.EVALUATE_QUEUE : env.JUDGE_QUEUE;
      await queue.send({
        runId: run.id,
        stage: retry.stage,
        stageVersion: "1",
      });
      if (run.showcaseId) {
        await getDb()
          .update(showcases)
          .set({
            judgeStatus: "queued",
            judgeDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(showcases.id, run.showcaseId));
      }
    } catch {
      await transitionRun({
        id: run.id,
        from: retry.targetStatus,
        to: "evaluation_failed",
        patch: {
          failureCode: `${retry.stage}_queue_unavailable`,
          failureSummary: "The failed pipeline stage could not be re-queued.",
        },
      });
      throw new EvaluationRetryUnavailableError();
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "run",
      entityId: run.id,
      action: "run.evaluation_requeued",
      metadata: {
        stage: retry.stage,
      },
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
