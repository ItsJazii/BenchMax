import { env } from "cloudflare:workers";
import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { refundRunCredits, reserveRunCredits } from "@/lib/data/credits";
import { getOwnedRun, transitionRun } from "@/lib/data/runs";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const PLATFORM_RUN_RESERVATION_MILLI_CREDITS = 100_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    await enforceRateLimit(identity.subject, {
      action: "run-platform-launch",
      limit: 5,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { id } = await context.params;
    const run = await getOwnedRun(id, user.id);
    if (!run || run.status !== "draft") {
      return secureJson({ error: "Draft run not found." }, { status: 404 });
    }
    if (run.credentialMode !== "platform-credit") {
      return secureJson(
        { error: "This run is configured for BYOK generation." },
        { status: 409 },
      );
    }

    await reserveRunCredits({
      runId: run.id,
      userId: user.id,
      amountMilliCredits: PLATFORM_RUN_RESERVATION_MILLI_CREDITS,
    });
    const queued = await transitionRun({
      id: run.id,
      from: "draft",
      to: "queued_generation",
    });
    try {
      await env.GENERATE_PLATFORM_QUEUE.send({
        runId: run.id,
        stage: "generate-platform",
        stageVersion: "1",
      });
    } catch {
      await transitionRun({
        id: run.id,
        from: "queued_generation",
        to: "generation_failed",
        patch: {
          failureCode: "generation_queue_unavailable",
          failureSummary:
            "The platform generation queue was unavailable. Reserved credits were restored.",
        },
      });
      await refundRunCredits({
        amountMilliCredits: PLATFORM_RUN_RESERVATION_MILLI_CREDITS,
        reason: "generation_queue_unavailable",
        runId: run.id,
        userId: user.id,
      });
      throw new PlatformQueueUnavailableError();
    }
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "run",
      entityId: run.id,
      action: "run.generation_queued",
      metadata: {
        credentialMode: "platform-credit",
        reservationMilliCredits: PLATFORM_RUN_RESERVATION_MILLI_CREDITS,
      },
    });
    return secureJson({ run: queued }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

class PlatformQueueUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super("Generation could not be queued. No platform credits were charged.");
    this.name = "PlatformQueueUnavailableError";
  }
}
