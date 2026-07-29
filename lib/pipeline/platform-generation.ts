import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs } from "@/db/schema";
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
} from "@/lib/generation/web-agent";

export async function generatePlatformRun(runId: string) {
  const contract = await getGenerationContract(runId);
  if (!contract || contract.credentialMode !== "platform-credit") {
    throw new PlatformGenerationContractError();
  }
  const [run] = await getDb()
    .select({ contributorId: runs.contributorId, status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) throw new PlatformGenerationContractError();

  if (run.status === "generated" || run.status === "queued_evaluation") {
    if (run.status === "generated") {
      await transitionRun({
        id: runId,
        from: "generated",
        to: "queued_evaluation",
      });
    }
    await enqueueEvaluation(runId);
    return { status: "queued_evaluation" as const };
  }
  if (run.status !== "queued_generation" && run.status !== "generating") {
    return { status: run.status };
  }
  if (run.status === "queued_generation") {
    await transitionRun({
      id: runId,
      from: "queued_generation",
      to: "generating",
    });
  }
  const startedAt = Date.now();
  try {
    const result = await executeWebAgentGeneration({
      apiKey: requiredPlatformKey(),
      contract,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    await persistSuccessfulGeneration({ result, runId, startedAt });
    await transitionRun({
      id: runId,
      from: "generated",
      to: "queued_evaluation",
    });
    await enqueueEvaluation(runId);
    await appendAuditEvent({
      actorUserId: null,
      entityType: "run",
      entityId: runId,
      action: "run.platform_generation_completed",
      metadata: {
        sourceSha256: result.sourceSha256,
        turnCount: result.turnCount,
      },
    });
    return { status: "queued_evaluation" as const };
  } catch (error) {
    if (error instanceof GenerationOutputError) {
      await markGenerationFailed(
        runId,
        error.code,
        "The model did not produce a usable pass@1 project.",
      );
      await transitionRun({
        id: runId,
        from: "generation_failed",
        to: "scored",
        patch: {
          overallScoreBps: 0,
          rankEligible: true,
          scoredAt: new Date(),
        },
      });
      await enqueuePublish(runId);
      await appendAuditEvent({
        actorUserId: null,
        entityType: "run",
        entityId: runId,
        action: "run.pass_at_one_failed",
        metadata: { code: error.code, scoreBps: 0 },
      });
      return { status: "scored" as const };
    }
    throw error;
  }
}

export async function enqueueEvaluation(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.EVALUATE_QUEUE.send({
    runId,
    stage: "evaluate",
    stageVersion: "1",
  });
}

export async function enqueueJudge(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.JUDGE_QUEUE.send({
    runId,
    stage: "judge",
    stageVersion: "1",
  });
}

export async function enqueuePublish(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.JUDGE_QUEUE.send({
    runId,
    stage: "publish",
    stageVersion: "1",
  });
}

function requiredPlatformKey() {
  const value = process.env.MOONSHOT_PLATFORM_API_KEY?.trim();
  if (!value || value.length > 4096) {
    throw new PlatformGenerationConfigurationError();
  }
  return value;
}

export class PlatformGenerationConfigurationError extends Error {
  constructor() {
    super("The platform generation provider is not configured.");
    this.name = "PlatformGenerationConfigurationError";
  }
}

export class PlatformGenerationContractError extends Error {
  constructor() {
    super("The platform generation contract is invalid.");
    this.name = "PlatformGenerationContractError";
  }
}
