import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { Sandbox } from "e2b";
import { z } from "zod";
import { getBrowserBenchmarkDefinition } from "@/benchmarks";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  generationRecords,
  objectiveResults,
  runArtifacts,
  runs,
} from "@/db/schema";
import { EVALUATION_ENVIRONMENT_V1 } from "@/lib/domain/ranked-catalog";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { sha256Hex } from "@/lib/security/policy";
import { transitionRun } from "@/lib/data/runs";
import { evaluatorReportContractError } from "@/lib/evaluation/report-contract";

const evaluatorReportSchema = z
  .object({
    protocolVersion: z.literal("frontend-static-evaluator-v1"),
    templateBuildHash: z.string().regex(/^[a-f0-9]{64}$/),
    weightedScoreBps: z.number().int().min(0).max(10_000),
    objectiveResults: z
      .array(
        z.object({
          checkKey: z.string().min(1).max(120),
          kind: z.string().min(1).max(80),
          status: z.enum(["pass", "fail", "error"]),
          scoreBps: z.number().int().min(0).max(10_000),
          weightBps: z.number().int().min(1).max(10_000),
          metric: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(50),
    consoleErrors: z.array(z.string().max(500)).max(100),
    serverLog: z.string().max(20_000),
    videoCaptureMs: z.literal(5_000),
    videoDurationMs: z.number().int().min(4_950).max(5_050),
  })
  .strict();

export async function evaluateFrontendRun(runId: string) {
  const contract = await getEvaluationContract(runId);
  if (!contract) throw new EvaluationContractError("missing_contract");
  const templateId = requiredSecret("E2B_TEMPLATE_ID");
  const templateBuildHash = requiredSha256("E2B_TEMPLATE_BUILD_HASH");
  const expectedEnvironmentHash = await canonicalSha256({
    evaluationPolicy: EVALUATION_ENVIRONMENT_V1,
    templateBuildHash,
    templateId,
  });
  if (
    contract.runEnvironmentHash !== expectedEnvironmentHash ||
    contract.benchmarkEnvironmentHash !== expectedEnvironmentHash
  ) {
    throw new EvaluationContractError("environment_hash_mismatch");
  }
  const benchmark = getBrowserBenchmarkDefinition(
    contract.benchmarkVersionId,
  );
  if (!benchmark) {
    throw new EvaluationContractError("unsupported_benchmark");
  }
  const { definition } = benchmark;
  const sourceObject = await env.UPLOADS.get(contract.sourceObjectKey);
  if (!sourceObject) throw new EvaluationContractError("source_missing");
  const sourceBytes = await sourceObject.arrayBuffer();

  if (contract.status === "queued_evaluation") {
    await transitionRun({
      id: runId,
      from: "queued_evaluation",
      to: "evaluating",
    });
  } else if (contract.status !== "evaluating") {
    throw new EvaluationContractError("invalid_run_state");
  }

  const sandbox = await Sandbox.create(templateId, {
    apiKey: requiredSecret("E2B_API_KEY"),
    allowInternetAccess: false,
    secure: true,
    timeoutMs: EVALUATION_ENVIRONMENT_V1.wallClockSeconds * 1000,
    lifecycle: { onTimeout: "kill" },
    metadata: {
      benchmaxRunId: runId,
      environmentHash: expectedEnvironmentHash,
    },
  });
  try {
    const specJson = canonicalJson({
      benchmarkVersionId: definition.id,
      checks: definition.checks,
      fixedClock: definition.fixedClock,
      interactionSteps: definition.interactionSteps,
      seed: definition.seed,
      viewport: definition.viewport,
    });
    await sandbox.files.write("/workspace/input/source.zip", sourceBytes);
    await sandbox.files.write("/workspace/input/spec.json", specJson);
    const extract = await sandbox.commands.run(
      "unzip -qq /workspace/input/source.zip -d /workspace/project",
      { timeoutMs: 20_000 },
    );
    if (extract.exitCode !== 0) {
      throw new EvaluationInfrastructureError("source_extract_failed");
    }
    const command = await sandbox.commands.run(
      "node /opt/benchmax/evaluate.mjs",
      { timeoutMs: EVALUATION_ENVIRONMENT_V1.wallClockSeconds * 1000 },
    );
    if (command.exitCode !== 0) {
      throw new EvaluationInfrastructureError("evaluator_process_failed");
    }
    const reportText = await sandbox.files.read(
      "/workspace/output/report.json",
    );
    const parsed = evaluatorReportSchema.parse(JSON.parse(reportText));
    if (parsed.templateBuildHash !== templateBuildHash) {
      throw new EvaluationContractError("report_environment_mismatch");
    }
    const reportContractError = evaluatorReportContractError({
      checks: definition.checks,
      objectiveResults: parsed.objectiveResults,
      weightedScoreBps: parsed.weightedScoreBps,
    });
    if (reportContractError) {
      throw new EvaluationContractError(reportContractError);
    }
    if (parsed.objectiveResults.some((result) => result.status === "error")) {
      throw new EvaluationInfrastructureError(
        "objective_checks_not_completed",
      );
    }
    const screenshot = await sandbox.files
      .read("/workspace/output/milestone.png", { format: "bytes" })
      .catch(() => null);
    const video = await sandbox.files
      .read("/workspace/output/milestone.webm", { format: "bytes" })
      .catch(() => null);
    if (
      !screenshot ||
      screenshot.byteLength === 0 ||
      !video ||
      video.byteLength === 0
    ) {
      throw new EvaluationInfrastructureError("evaluator_evidence_missing");
    }
    await persistEvaluation({
      commandLog: canonicalJson({
        exitCode: command.exitCode,
        stderr: command.stderr.slice(0, 20_000),
        stdout: command.stdout.slice(0, 20_000),
      }),
      definition,
      report: parsed,
      reportText,
      runId,
      screenshot,
      video,
    });
    return parsed;
  } finally {
    await sandbox.kill().catch(() => false);
  }
}

async function getEvaluationContract(runId: string) {
  const [row] = await getDb()
    .select({
      benchmarkVersionId: runs.benchmarkVersionId,
      benchmarkEnvironmentHash: benchmarkVersions.environmentHash,
      runEnvironmentHash: runs.environmentHash,
      sourceObjectKey: runArtifacts.objectKey,
      status: runs.status,
    })
    .from(runs)
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .innerJoin(generationRecords, eq(generationRecords.runId, runs.id))
    .innerJoin(
      runArtifacts,
      and(
        eq(runArtifacts.runId, runs.id),
        eq(runArtifacts.kind, "generated-source"),
      ),
    )
    .where(eq(runs.id, runId))
    .limit(1);
  return row ?? null;
}

async function persistEvaluation(input: {
  commandLog: string;
  definition: NonNullable<
    ReturnType<typeof getBrowserBenchmarkDefinition>
  >["definition"];
  report: z.infer<typeof evaluatorReportSchema>;
  reportText: string;
  runId: string;
  screenshot: Uint8Array | null;
  video: Uint8Array | null;
}) {
  const now = new Date();
  const reportBytes = new TextEncoder().encode(input.reportText);
  const reportSha = await sha256Hex(reportBytes.buffer);
  const reportObjectKey = `runs/${input.runId}/evaluation/${reportSha}.json`;
  await env.UPLOADS.put(reportObjectKey, reportBytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { benchmaxRun: input.runId, sha256: reportSha },
  });
  await getDb()
    .insert(runArtifacts)
    .values({
      id: crypto.randomUUID(),
      runId: input.runId,
      kind: "evaluation-report",
      objectKey: reportObjectKey,
      contentType: "application/json",
      byteSize: reportBytes.byteLength,
      sha256: reportSha,
      public: true,
      createdAt: now,
    })
    .onConflictDoNothing();

  const logBytes = new TextEncoder().encode(input.commandLog);
  const logSha = await sha256Hex(logBytes.buffer);
  const logObjectKey = `runs/${input.runId}/evaluation/${logSha}.log`;
  await env.UPLOADS.put(logObjectKey, logBytes, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });
  await getDb()
    .insert(runArtifacts)
    .values({
      id: crypto.randomUUID(),
      runId: input.runId,
      kind: "run-log",
      objectKey: logObjectKey,
      contentType: "text/plain; charset=utf-8",
      byteSize: logBytes.byteLength,
      sha256: logSha,
      public: true,
      createdAt: now,
    })
    .onConflictDoNothing();

  if (input.screenshot && input.screenshot.byteLength > 0) {
    const screenshotSha = await sha256Hex(input.screenshot.slice().buffer);
    const screenshotObjectKey = `runs/${input.runId}/evaluation/${screenshotSha}.png`;
    await env.UPLOADS.put(screenshotObjectKey, input.screenshot, {
      httpMetadata: { contentType: "image/png" },
    });
    await getDb()
      .insert(runArtifacts)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        kind: "screenshot",
        objectKey: screenshotObjectKey,
        contentType: "image/png",
        byteSize: input.screenshot.byteLength,
        sha256: screenshotSha,
        public: true,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  if (input.video && input.video.byteLength > 0) {
    const videoSha = await sha256Hex(input.video.slice().buffer);
    const videoObjectKey = `runs/${input.runId}/evaluation/${videoSha}.webm`;
    await env.UPLOADS.put(videoObjectKey, input.video, {
      httpMetadata: { contentType: "video/webm" },
    });
    await getDb()
      .insert(runArtifacts)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        kind: "video",
        objectKey: videoObjectKey,
        contentType: "video/webm",
        byteSize: input.video.byteLength,
        sha256: videoSha,
        public: true,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  const objectiveDimension =
    input.definition.rubric.find((dimension) => dimension.mechanism === "objective")
      ?.key ?? input.definition.rubric[0].key;
  const hybridDimension =
    input.definition.rubric.find((dimension) => dimension.mechanism === "hybrid")
      ?.key ?? objectiveDimension;
  for (const result of input.report.objectiveResults) {
    await getDb()
      .insert(objectiveResults)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        dimensionKey:
          result.kind === "accessibility"
            ? hybridDimension
            : objectiveDimension,
        checkKey: result.checkKey,
        status: result.status,
        scoreBps: result.scoreBps,
        metricValueJson: canonicalJson({
          ...result.metric,
          weightBps: result.weightBps,
        }),
        evidenceArtifactId: null,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  await getDb()
    .update(runs)
    .set({ evaluatedAt: now, updatedAt: now })
    .where(eq(runs.id, input.runId));
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 4096) {
    throw new EvaluationConfigurationError(name);
  }
  return value;
}

function requiredSha256(name: string) {
  const value = requiredSecret(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new EvaluationConfigurationError(name);
  }
  return value;
}

export class EvaluationConfigurationError extends Error {
  constructor(readonly key: string) {
    super("The evaluator is not configured.");
    this.name = "EvaluationConfigurationError";
  }
}

export class EvaluationContractError extends Error {
  constructor(readonly code: string) {
    super("The frozen evaluation contract is invalid.");
    this.name = "EvaluationContractError";
  }
}

export class EvaluationInfrastructureError extends Error {
  constructor(readonly code: string) {
    super("The frozen evaluator infrastructure could not complete the run.");
    this.name = "EvaluationInfrastructureError";
  }
}
