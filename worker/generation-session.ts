import { DurableObject } from "cloudflare:workers";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  getGenerationContract,
  markGenerationFailed,
  persistSuccessfulGeneration,
} from "@/lib/data/generation";
import { transitionRun } from "@/lib/data/runs";
import {
  executeWebAgentGeneration,
  GenerationOutputError,
  GenerationProviderError,
} from "@/lib/generation/web-agent";
import { enqueuePublish } from "@/lib/pipeline/platform-generation";
import { byokStartMessageSchema } from "@/lib/security/run-policy";

type SessionEnv = Cloudflare.Env;

export class GenerationSession extends DurableObject<SessionEnv> {
  private activeAbort: AbortController | null = null;
  private activeSocket: WebSocket | null = null;
  private started = false;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }
    const runId = request.headers.get("x-benchmax-run-id") ?? "";
    const userId = request.headers.get("x-benchmax-user-id") ?? "";
    if (
      !/^[0-9a-f-]{36}$/i.test(runId) ||
      !/^[0-9a-f-]{36}$/i.test(userId)
    ) {
      return new Response("Invalid internal session.", { status: 400 });
    }
    const contract = await getGenerationContract(runId);
    if (!contract || contract.credentialMode !== "byok") {
      return new Response("Run is not available for BYOK generation.", {
        status: 409,
      });
    }
    if (this.activeSocket) {
      return new Response("Generation session is already active.", {
        status: 409,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.activeSocket = server;
    server.addEventListener("message", (event) => {
      if (this.started) {
        this.send({ type: "error", code: "already_started" });
        return;
      }
      this.started = true;
      this.ctx.waitUntil(
        this.startGeneration({
          contract,
          rawMessage: event.data,
          runId,
          userId,
        }),
      );
    });
    server.addEventListener("close", () => {
      this.activeAbort?.abort("generation_socket_closed");
      this.activeSocket = null;
    });
    server.addEventListener("error", () => {
      this.activeAbort?.abort("generation_socket_error");
      this.activeSocket = null;
    });
    this.send({ type: "ready", runId });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async startGeneration(input: {
    contract: Awaited<ReturnType<typeof getGenerationContract>> & {};
    rawMessage: string | ArrayBuffer;
    runId: string;
    userId: string;
  }) {
    if (!input.contract) return;
    let parsedMessage: unknown;
    try {
      const text =
        typeof input.rawMessage === "string"
          ? input.rawMessage
          : new TextDecoder().decode(input.rawMessage);
      parsedMessage = JSON.parse(text);
    } catch {
      this.send({ type: "error", code: "invalid_start_message" });
      this.close(1008, "Invalid start message");
      return;
    }
    const parsed = byokStartMessageSchema.safeParse(parsedMessage);
    if (!parsed.success) {
      this.send({ type: "error", code: "invalid_start_message" });
      this.close(1008, "Invalid start message");
      return;
    }

    this.activeAbort = new AbortController();
    const startedAt = Date.now();
    let apiKey = parsed.data.apiKey;
    try {
      await transitionRun({
        id: input.runId,
        from: "draft",
        to: "generating",
      });
      await appendAuditEvent({
        actorUserId: input.userId,
        entityType: "run",
        entityId: input.runId,
        action: "run.generation_started",
        metadata: { credentialMode: "byok", passPolicy: "pass@1" },
      });
      this.send({ type: "started", runId: input.runId });
      const result = await executeWebAgentGeneration({
        apiKey,
        contract: input.contract,
        signal: this.activeAbort.signal,
        onEvent: (event) => this.send(event),
      });
      apiKey = "";
      if (this.activeAbort.signal.aborted) {
        throw new DOMException("Generation connection closed.", "AbortError");
      }
      await persistSuccessfulGeneration({
        result,
        runId: input.runId,
        startedAt,
      });
      const queued = await transitionRun({
        id: input.runId,
        from: "generated",
        to: "queued_evaluation",
      });
      try {
        await this.env.EVALUATE_QUEUE.send({
          runId: input.runId,
          stage: "evaluate",
          stageVersion: "1",
        });
      } catch {
        await transitionRun({
          id: input.runId,
          from: "queued_evaluation",
          to: "evaluation_failed",
          patch: {
            failureCode: "evaluation_queue_unavailable",
            failureSummary:
              "Generation completed, but evaluation could not be queued. The API key was destroyed and is not needed for evaluation retry.",
          },
        });
        throw new EvaluationQueueUnavailableError();
      }
      await appendAuditEvent({
        actorUserId: input.userId,
        entityType: "run",
        entityId: input.runId,
        action: "run.generation_completed",
        metadata: {
          credentialMode: "byok",
          sourceSha256: result.sourceSha256,
          turnCount: result.turnCount,
          nextStatus: queued.status,
        },
      });
      this.send({
        type: "complete",
        runId: input.runId,
        status: queued.status,
      });
      this.close(1000, "Generation complete");
    } catch (error) {
      apiKey = "";
      const code =
        error instanceof GenerationProviderError ||
        error instanceof GenerationOutputError
          ? error.code
          : error instanceof EvaluationQueueUnavailableError
            ? error.code
          : error instanceof DOMException && error.name === "AbortError"
            ? "byok_connection_lost"
            : "generation_internal_error";
      try {
        if (error instanceof EvaluationQueueUnavailableError) {
          // Generation is already persisted and only evaluation needs retry.
        } else {
          await markGenerationFailed(input.runId, code, safeFailureSummary(code));
          if (error instanceof GenerationOutputError) {
            await transitionRun({
              id: input.runId,
              from: "generation_failed",
              to: "scored",
              patch: {
                overallScoreBps: 0,
                rankEligible: true,
                scoredAt: new Date(),
              },
            });
            await enqueuePublish(input.runId);
          }
        }
        await appendAuditEvent({
          actorUserId: input.userId,
          entityType: "run",
          entityId: input.runId,
          action:
            error instanceof EvaluationQueueUnavailableError
              ? "run.evaluation_queue_failed"
              : "run.generation_failed",
          metadata:
            error instanceof EvaluationQueueUnavailableError
              ? {
                  credentialMode: "byok",
                  retryPolicy: "evaluation-only",
                  code,
                }
              : {
                  credentialMode: "byok",
                  retryPolicy: "user-reinitiation-only",
                  code,
                },
        });
      } catch {
        // A completed or independently failed state is never overwritten.
      }
      this.send({ type: "failed", code, retryable: false });
      this.close(1011, "Generation failed");
    } finally {
      apiKey = "";
      this.activeAbort = null;
      this.activeSocket = null;
    }
  }

  private send(value: Record<string, unknown>) {
    try {
      this.activeSocket?.send(JSON.stringify(value));
    } catch {
      this.activeAbort?.abort("generation_socket_send_failed");
    }
  }

  private close(code: number, reason: string) {
    try {
      this.activeSocket?.close(code, reason);
    } finally {
      this.activeSocket = null;
    }
  }
}

class EvaluationQueueUnavailableError extends Error {
  readonly code = "evaluation_queue_unavailable";
}

function safeFailureSummary(code: string): string {
  if (code === "byok_connection_lost") {
    return "The live BYOK session ended before generation completed.";
  }
  if (code.startsWith("provider_")) {
    return "The provider did not complete the generation request.";
  }
  if (code === "turn_limit_exhausted") {
    return "The model reached the frozen agent turn limit without a complete project.";
  }
  if (code === "generated_secret_detected") {
    return "The generated project was blocked by secret-pattern scanning.";
  }
  return "Generation failed inside the isolated session.";
}
