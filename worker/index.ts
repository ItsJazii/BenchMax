/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { publicSecurityHeaders } from "../lib/security/http";
import type { PipelineMessage } from "../lib/pipeline/messages";
import {
  claimStage,
  completeStage,
  failStage,
} from "../lib/pipeline/stage-claims";
import { enqueueJudge, enqueuePublish } from "../lib/pipeline/result-queue";
import {
  EvaluationContractError,
  evaluateFrontendRun,
} from "../lib/evaluation/frontend";
import { judgeRun } from "../lib/judging/judge-run";
import { transitionRun } from "../lib/data/runs";
import { getDb } from "../db";
import { runs, showcases } from "../db/schema";
import { eq } from "drizzle-orm";
import { rebuildBenchmarkSnapshot } from "../lib/ranking/snapshots";
import { appendAuditEvent } from "../lib/data/audit";
import { rebuildAggregateSnapshots } from "../lib/ranking/aggregates";
import { rebuildResultLeaderboard } from "../lib/ranking/result-snapshots";
import { runJudgeCalibration } from "../lib/judging/calibration";
import {
  recoverStalledPipelineRuns,
  stageClaimDisposition,
} from "../lib/pipeline/recovery";
import { processPipelineDeadLetter } from "../lib/pipeline/dead-letter";
import { sweepExpiredUploadSessions } from "../lib/data/upload-maintenance";
import { markOverdueResults } from "../lib/data/results";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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
  async queue(
    batch: MessageBatch<PipelineMessage>,
    env: Env,
  ): Promise<void> {
    if (batch.queue === "benchmax-pipeline-dlq") {
      await consumePipelineDeadLetters(batch);
      return;
    }
    for (const message of batch.messages) {
      const body = message.body;
      if (!isPipelineMessage(body)) {
        message.ack();
        continue;
      }
      const claim = await claimStage(body);
      const disposition = stageClaimDisposition(claim);
      if (disposition.action === "ack") {
        message.ack();
        continue;
      }
      if (disposition.action === "retry") {
        message.retry({ delaySeconds: disposition.delaySeconds });
        continue;
      }
      try {
        await executePipelineMessage(body);
        await completeStage(disposition.claimId);
        message.ack();
      } catch (error) {
        const code = pipelineErrorCode(error);
        await failStage(disposition.claimId, code);
        const terminal = await handleTerminalPipelineFailure({
          attempts: message.attempts,
          body,
          code,
          error,
        });
        if (terminal) {
          try {
            await env.PIPELINE_DLQ.send(body);
            message.ack();
          } catch {
            message.retry({ delaySeconds: 300 });
          }
        } else {
          message.retry({
            delaySeconds: Math.min(300, 5 * 2 ** message.attempts),
          });
        }
      }
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    if (controller.cron === "0 3 * * 1") {
      jobs.push(
        runJudgeCalibration().catch((error) => {
          console.error("Benchmax scheduled calibration failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
        }),
      );
    }
    jobs.push(
      recoverPipelineRuns(env).catch((error) => {
        console.error("Benchmax pipeline recovery sweep failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }),
    );
    jobs.push(
      sweepExpiredUploadSessions().catch((error) => {
        console.error("Benchmax upload quarantine sweep failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }),
    );
    jobs.push(
      markOverdueResults().catch((error) => {
        console.error("Benchmax overdue result sweep failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }),
    );
    ctx.waitUntil(Promise.all(jobs));
  },
};

async function recoverPipelineRuns(env: Env) {
  const messages = await recoverStalledPipelineRuns({
    auditTransition: ({ from, runId, stage, to }) =>
      appendAuditEvent({
        actorUserId: null,
        entityType: "run",
        entityId: runId,
        action: "run.recovery_transitioned",
        metadata: { from, stage, to },
      }),
    db: env.DB,
    queues: {
      evaluate: env.EVALUATE_QUEUE,
      judge: env.JUDGE_QUEUE,
    },
  });
  for (const message of messages) {
    await appendAuditEvent({
      actorUserId: null,
      entityType: "run",
      entityId: message.runId,
      action: "run.pipeline_recovered",
      metadata: { stage: message.stage, stageVersion: message.stageVersion },
    });
  }
}

async function consumePipelineDeadLetters(
  batch: MessageBatch<PipelineMessage>,
) {
  for (const message of batch.messages) {
    if (!isPipelineMessage(message.body)) {
      message.ack();
      continue;
    }
    await processPipelineDeadLetter(message.body, {
      getRunStatus,
      markFailed: ({ code, runId, stage }) =>
        failRunAtCurrentStage(runId, stage, code),
      audit: ({ action, entityId, metadata }) =>
        appendAuditEvent({
          actorUserId: null,
          entityType: "run",
          entityId,
          action,
          metadata,
        }),
      },
    );
    message.ack();
  }
}

async function executePipelineMessage(message: PipelineMessage) {
  if (message.stage === "evaluate") {
    const status = await getRunStatus(message.runId);
    if (status === "judging") return;
    if (status === "scored") {
      await enqueuePublish(message.runId);
      return;
    }
    if (status === "published") return;
    await evaluateFrontendRun(message.runId);
    await enqueueJudge(message.runId);
    return;
  }
  if (message.stage === "judge") {
    const status = await getRunStatus(message.runId);
    if (status === "scored") {
      await enqueuePublish(message.runId);
      return;
    }
    if (status === "published") return;
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
      rankEligible: runs.rankEligible,
      showcaseId: runs.showcaseId,
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
    if (run.showcaseId) {
      await rebuildResultLeaderboard({
        benchmarkVersionId: run.benchmarkVersionId,
        evaluationVersionId: run.evaluationVersionId,
      });
    } else {
      await rebuildBenchmarkSnapshot({
        benchmarkVersionId: run.benchmarkVersionId,
        evaluationVersionId: run.evaluationVersionId,
      });
      await rebuildAggregateSnapshots(run.evaluationVersionId);
    }
  }
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: message.runId,
    action: "run.published",
    metadata: { rankEligible: run.rankEligible },
  });
}

async function getRunStatus(runId: string) {
  const [run] = await getDb()
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run?.status ?? null;
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
      status: runs.status,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) return;
  let failed = false;
  if (
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
    failed = true;
  } else if (
    stage === "publish" &&
    row.status === "scored"
  ) {
    await transitionRun({
      id: runId,
      from: row.status,
      to: "evaluation_failed",
      patch: {
        failureCode: code,
        failureSummary:
          "Publishing stopped after the bounded infrastructure retry policy.",
      },
    });
    failed = true;
  }
  if (!failed) return;
  const [failedRun] = await getDb()
    .select({ showcaseId: runs.showcaseId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (failedRun?.showcaseId) {
    await getDb()
      .update(showcases)
      .set({ judgeStatus: "failed", updatedAt: new Date() })
      .where(eq(showcases.id, failedRun.showcaseId));
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
    ["evaluate", "judge", "publish"].includes(
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
