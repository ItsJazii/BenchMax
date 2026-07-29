/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { publicSecurityHeaders } from "../lib/security/http";
import { apiErrorResponse } from "../lib/http/api";
import { requireAuthorizedUser } from "../lib/auth/authorization";
import { getOwnedRun } from "../lib/data/runs";
import type { PipelineMessage } from "../lib/pipeline/messages";
import {
  claimStage,
  completeStage,
  failStage,
} from "../lib/pipeline/stage-claims";
import {
  enqueueJudge,
  enqueuePublish,
  generatePlatformRun,
} from "../lib/pipeline/platform-generation";
import {
  EvaluationContractError,
  EvaluationDeterministicError,
  evaluateFrontendRun,
} from "../lib/evaluation/frontend";
import { judgeRun } from "../lib/judging/judge-run";
import { transitionRun } from "../lib/data/runs";
import { getDb } from "../db";
import { runs } from "../db/schema";
import { eq } from "drizzle-orm";
import { rebuildBenchmarkSnapshot } from "../lib/ranking/snapshots";
import { appendAuditEvent } from "../lib/data/audit";
import { rebuildAggregateSnapshots } from "../lib/ranking/aggregates";
import { isAuthorizedRequestOrigin } from "../lib/auth/server";
import { enforceRateLimit } from "../lib/security/rate-limit";
import { runJudgeCalibration } from "../lib/judging/calibration";
import {
  refundRunCredits,
  settlePlatformRunCredits,
} from "../lib/data/credits";

export { GenerationSession } from "./generation-session";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  GENERATION_SESSION: DurableObjectNamespace;
  GENERATE_PLATFORM_QUEUE: Queue<import("../lib/pipeline/messages").PipelineMessage>;
  EVALUATE_QUEUE: Queue<import("../lib/pipeline/messages").PipelineMessage>;
  JUDGE_QUEUE: Queue<import("../lib/pipeline/messages").PipelineMessage>;
  PIPELINE_DLQ: Queue<import("../lib/pipeline/messages").PipelineMessage>;
  UPLOADS: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const byokMatch =
      /^\/api\/runs\/([0-9a-f-]{36})\/generate\/byok$/i.exec(url.pathname);
    if (byokMatch && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      try {
        if (!isAuthorizedRequestOrigin(request)) {
          return withSecurityHeaders(
            request,
            new Response("WebSocket origin is not authorized.", {
              status: 403,
            }),
          );
        }
        const { user } = await requireAuthorizedUser(request);
        await enforceRateLimit(user.authSubject, {
          action: "run-byok-session",
          limit: 10,
          windowMs: 24 * 60 * 60 * 1000,
        });
        const run = await getOwnedRun(byokMatch[1], user.id);
        if (
          !run ||
          run.status !== "draft" ||
          run.credentialMode !== "byok"
        ) {
          return withSecurityHeaders(
            request,
            new Response(JSON.stringify({ error: "BYOK draft not found." }), {
              status: 404,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }),
          );
        }
        const id = env.GENERATION_SESSION.idFromName(run.id);
        const stub = env.GENERATION_SESSION.get(id);
        const headers = new Headers(request.headers);
        headers.delete("authorization");
        headers.delete("cookie");
        headers.set("x-benchmax-run-id", run.id);
        headers.set("x-benchmax-user-id", user.id);
        return stub.fetch(new Request(request, { headers }));
      } catch (error) {
        return apiErrorResponse(error);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const imageResponse = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(request, imageResponse);
    }

    const response = await handler.fetch(request, env, ctx);
    return withSecurityHeaders(request, response);
  },
  async queue(batch: MessageBatch<PipelineMessage>): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body;
      if (!isPipelineMessage(body)) {
        message.ack();
        continue;
      }
      const claim = await claimStage(body);
      if (!claim) {
        message.ack();
        continue;
      }
      try {
        await executePipelineMessage(body);
        await completeStage(claim.id);
        message.ack();
      } catch (error) {
        const code = pipelineErrorCode(error);
        await failStage(claim.id, code);
        const terminal = await handleTerminalPipelineFailure({
          attempts: message.attempts,
          body,
          code,
          error,
        });
        if (terminal) message.ack();
        else message.retry({ delaySeconds: Math.min(300, 5 * 2 ** message.attempts) });
      }
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    void controller;
    void env;
    ctx.waitUntil(
      runJudgeCalibration().catch((error) => {
        console.error("Benchmax scheduled calibration failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }),
    );
  },
};

async function executePipelineMessage(message: PipelineMessage) {
  if (message.stage === "generate-platform") {
    await generatePlatformRun(message.runId);
    return;
  }
  if (message.stage === "evaluate") {
    try {
      await evaluateFrontendRun(message.runId);
      await enqueueJudge(message.runId);
    } catch (error) {
      if (error instanceof EvaluationDeterministicError) {
        await transitionRun({
          id: message.runId,
          from: "evaluating",
          to: "scored",
          patch: {
            overallScoreBps: 0,
            rankEligible: true,
            scoredAt: new Date(),
            failureCode: error.code,
            failureSummary:
              "The generated pass@1 project failed deterministic execution checks.",
          },
        });
        await enqueuePublish(message.runId);
        return;
      }
      throw error;
    }
    return;
  }
  if (message.stage === "judge") {
    await judgeRun(message.runId);
    await enqueuePublish(message.runId);
    return;
  }
  const [run] = await getDb()
    .select({
      benchmarkVersionId: runs.benchmarkVersionId,
      evaluationVersionId: runs.evaluationVersionId,
      injectionFlag: runs.injectionFlag,
      outputContentHash: runs.outputContentHash,
      contributorId: runs.contributorId,
      credentialMode: runs.credentialMode,
      rankEligible: runs.rankEligible,
      status: runs.status,
    })
    .from(runs)
    .where(eq(runs.id, message.runId))
    .limit(1);
  if (!run) return;
  if (run.status === "scored") {
    const usercontentConfigured = Boolean(
      process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN &&
        process.env.BENCHMAX_APP_ORIGIN,
    );
    await transitionRun({
      id: message.runId,
      from: "scored",
      to: "published",
      patch: {
        playableEnabled:
          usercontentConfigured &&
          !run.injectionFlag &&
          Boolean(run.outputContentHash),
        publishedAt: new Date(),
      },
    });
  } else if (run.status !== "published") {
    return;
  }
  if (run.rankEligible) {
    await rebuildBenchmarkSnapshot({
      benchmarkVersionId: run.benchmarkVersionId,
      evaluationVersionId: run.evaluationVersionId,
    });
    await rebuildAggregateSnapshots(run.evaluationVersionId);
  }
  if (run.credentialMode === "platform-credit") {
    await settlePlatformRunCredits({
      runId: message.runId,
      userId: run.contributorId,
    });
  }
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: message.runId,
    action: "run.published",
    metadata: { rankEligible: run.rankEligible },
  });
}

async function handleTerminalPipelineFailure(input: {
  attempts: number;
  body: PipelineMessage;
  code: string;
  error: unknown;
}) {
  if (input.error instanceof EvaluationContractError) {
    await failRunAtCurrentStage(input.body.runId, input.body.stage, input.code);
    return true;
  }
  if (input.attempts < 4) return false;
  await failRunAtCurrentStage(input.body.runId, input.body.stage, input.code);
  return true;
}

async function failRunAtCurrentStage(
  runId: string,
  stage: PipelineMessage["stage"],
  code: string,
) {
  const [row] = await getDb()
    .select({
      contributorId: runs.contributorId,
      credentialMode: runs.credentialMode,
      status: runs.status,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) return;
  if (
    stage === "generate-platform" &&
    (row.status === "queued_generation" || row.status === "generating")
  ) {
    await transitionRun({
      id: runId,
      from: row.status,
      to: "generation_failed",
      patch: {
        failureCode: code,
        failureSummary:
          "Platform generation stopped after the bounded retry policy.",
      },
    });
    if (row.credentialMode === "platform-credit") {
      await refundRunCredits({
        amountMilliCredits: 100_000,
        reason: "platform_generation_retry_exhausted",
        runId,
        userId: row.contributorId,
      });
    }
  } else if (
    (stage === "evaluate" || stage === "judge") &&
    (row.status === "queued_evaluation" ||
      row.status === "evaluating" ||
      row.status === "judging")
  ) {
    await transitionRun({
      id: runId,
      from: row.status,
      to: "evaluation_failed",
      patch: {
        failureCode: code,
        failureSummary:
          "Evaluation stopped after the bounded infrastructure retry policy.",
      },
    });
  }
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: runId,
    action: "run.pipeline_failed",
    metadata: { code, stage },
  });
}

function isPipelineMessage(value: unknown): value is PipelineMessage {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<PipelineMessage>;
  return (
    /^[0-9a-f-]{36}$/i.test(body.runId ?? "") &&
    ["generate-platform", "evaluate", "judge", "publish"].includes(
      body.stage ?? "",
    ) &&
    /^[a-z0-9._-]{1,40}$/i.test(body.stageVersion ?? "")
  );
}

function pipelineErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return /^[a-z0-9_:-]{1,80}$/.test(error.code)
      ? error.code
      : "pipeline_error";
  }
  return error instanceof Error
    ? error.name
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .slice(0, 80)
    : "pipeline_error";
}

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of publicSecurityHeaders()) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
