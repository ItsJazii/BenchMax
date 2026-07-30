import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  dimensionScores,
  evaluationVersions,
  judgeSamples,
  objectiveResults,
  rubricDimensions,
  runArtifacts,
  runs,
} from "@/db/schema";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { assertSafeProviderOrigin } from "@/lib/security/run-policy";
import { transitionRun } from "@/lib/data/runs";
import {
  buildJudgePromptPayload,
  createJudgeOutputSchema,
  median,
  prepareJudgeEvidence,
} from "./protocol";

const providerResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string().min(2).max(100_000) }),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();

export async function judgeRun(runId: string) {
  const contract = await loadJudgeContract(runId);
  if (!contract) throw new JudgeContractError("missing_contract");
  if (contract.evaluationStatus !== "active") {
    throw new JudgeContractError("evaluation_not_active");
  }
  if (contract.sampleCount !== 3) {
    throw new JudgeContractError("sample_count_not_three");
  }
  if (contract.runStatus === "evaluating") {
    await transitionRun({ id: runId, from: "evaluating", to: "judging" });
  } else if (contract.runStatus !== "judging") {
    throw new JudgeContractError("invalid_run_state");
  }

  const sourceObject = await env.UPLOADS.get(contract.sourceObjectKey);
  if (!sourceObject) throw new JudgeContractError("source_missing");
  const sourceBytes = new Uint8Array(await sourceObject.arrayBuffer());

  const dimensions = await getDb()
    .select()
    .from(rubricDimensions)
    .where(eq(rubricDimensions.benchmarkVersionId, contract.benchmarkVersionId))
    .orderBy(rubricDimensions.ordinal);
  const judgeDimensions = dimensions.filter(
    (dimension) => dimension.mechanism !== "objective",
  );
  if (judgeDimensions.length === 0) {
    throw new JudgeContractError("judge_dimensions_missing");
  }
  const objectiveRows = await getDb()
    .select()
    .from(objectiveResults)
    .where(eq(objectiveResults.runId, runId));
  if (objectiveRows.length === 0) {
    throw new JudgeContractError("objective_results_missing");
  }
  const screenshot = await loadBoundedScreenshot(runId);
  const needsSource = judgeDimensions.some(
    (dimension) => dimension.judgeSourceRequired,
  );
  const objectiveEvidence = inputObjectiveEvidence(objectiveRows);
  const preparedEvidence = prepareJudgeEvidence({
    includeSource: needsSource,
    runtimeEvidence: [
      {
        label: "objective-runtime-results",
        value: objectiveEvidence,
      },
    ],
    sourceBytes,
  });
  const injection = preparedEvidence.injection;
  if (injection.flagged) {
    await getDb()
      .update(runs)
      .set({ injectionFlag: true, rankEligible: false, updatedAt: new Date() })
      .where(eq(runs.id, runId));
  }
  const prompt = buildJudgePrompt({
    benchmarkPrompt: contract.benchmarkPrompt,
    injectionFlag: injection.flagged,
    objectiveRows,
    rubric: judgeDimensions,
    untrustedEvidence: preparedEvidence.untrustedEvidence,
  });
  const outputSchema = createJudgeOutputSchema(
    judgeDimensions.map((dimension) => dimension.key),
  );

  const samples: Array<z.infer<typeof outputSchema>> = [];
  for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
    const existing = await getDb()
      .select({ structuredOutputJson: judgeSamples.structuredOutputJson })
      .from(judgeSamples)
      .where(
        and(
          eq(judgeSamples.runId, runId),
          eq(judgeSamples.evaluationVersionId, contract.evaluationVersionId),
          eq(judgeSamples.sampleIndex, sampleIndex),
        ),
      )
      .limit(1);
    if (existing[0]) {
      samples.push(outputSchema.parse(JSON.parse(existing[0].structuredOutputJson)));
      continue;
    }
    const startedAt = Date.now();
    const response = await callPinnedJudge({
      endpointOrigin: contract.judgeEndpointOrigin,
      maxTokens: contract.maxTokensPerSample,
      model: contract.judgeModel,
      prompt: `${contract.promptTemplate}\n\n${prompt}`,
      screenshot,
    });
    const structured = outputSchema.parse(JSON.parse(response.content));
    const structuredOutputJson = canonicalJson(structured);
    await getDb().insert(judgeSamples).values({
      id: crypto.randomUUID(),
      runId,
      evaluationVersionId: contract.evaluationVersionId,
      sampleIndex,
      structuredOutputJson,
      responseHash: await canonicalSha256(structured),
      injectionFlag: injection.flagged,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs: Math.max(0, Date.now() - startedAt),
      createdAt: new Date(),
    });
    samples.push(structured);
  }

  const objectiveScoreBps = weightedObjectiveScore(objectiveRows);
  const judgeScores = new Map<string, number>();
  const judgeReasoning = new Map<string, string>();
  for (const dimension of judgeDimensions) {
    judgeScores.set(
      dimension.key,
      median(
        samples.map(
          (sample) =>
            sample.dimensions.find((item) => item.key === dimension.key)!
              .score_bps,
        ),
      ),
    );
    judgeReasoning.set(
      dimension.key,
      samples
        .map(
          (sample) =>
            sample.dimensions.find((item) => item.key === dimension.key)!
              .reasoning,
        )
        .join(" | ")
        .slice(0, 4_000),
    );
  }
  const judgeWeight = judgeDimensions.reduce(
    (sum, dimension) => sum + dimension.weightBps,
    0,
  );
  const judgeScoreBps = Math.round(
    judgeDimensions.reduce(
      (sum, dimension) =>
        sum + (judgeScores.get(dimension.key) ?? 0) * dimension.weightBps,
      0,
    ) / judgeWeight,
  );
  const overallScoreBps = Math.round(
    (objectiveScoreBps * contract.objectiveWeightBps +
      judgeScoreBps * contract.judgeWeightBps) /
      10_000,
  );

  for (const dimension of dimensions) {
    const dimensionObjective = weightedObjectiveScore(
      objectiveRows.filter((row) => row.dimensionKey === dimension.key),
      objectiveScoreBps,
    );
    const dimensionJudge = judgeScores.get(dimension.key) ?? null;
    const combined =
      dimension.mechanism === "objective"
        ? dimensionObjective
        : dimension.mechanism === "judge"
          ? (dimensionJudge ?? 0)
          : Math.round(
              (dimensionObjective * contract.objectiveWeightBps +
                (dimensionJudge ?? 0) * contract.judgeWeightBps) /
                10_000,
            );
    await getDb()
      .insert(dimensionScores)
      .values({
        id: crypto.randomUUID(),
        runId,
        rubricDimensionId: dimension.id,
        objectiveScoreBps:
          dimension.mechanism === "judge" ? null : dimensionObjective,
        judgeMedianScoreBps: dimensionJudge,
        originalCombinedScoreBps: combined,
        adjustedCombinedScoreBps: null,
        overrideActionId: null,
        reasoning:
          judgeReasoning.get(dimension.key) ??
          "Computed from the frozen objective checks.",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  await transitionRun({
    id: runId,
    from: "judging",
    to: "scored",
    patch: {
      overallScoreBps,
      rankEligible: !injection.flagged,
      scoredAt: new Date(),
    },
  });
  return { injectionFlag: injection.flagged, overallScoreBps };
}

async function loadJudgeContract(runId: string) {
  const [row] = await getDb()
    .select({
      benchmarkPrompt: benchmarkVersions.canonicalPrompt,
      benchmarkVersionId: benchmarkVersions.id,
      evaluationStatus: evaluationVersions.status,
      evaluationVersionId: evaluationVersions.id,
      judgeEndpointOrigin: evaluationVersions.endpointOrigin,
      judgeModel: evaluationVersions.judgeModel,
      judgeWeightBps: benchmarkVersions.judgeWeightBps,
      maxTokensPerSample: evaluationVersions.maxTokensPerSample,
      objectiveWeightBps: benchmarkVersions.objectiveWeightBps,
      promptTemplate: evaluationVersions.promptTemplate,
      runStatus: runs.status,
      sampleCount: evaluationVersions.sampleCount,
      sourceObjectKey: runArtifacts.objectKey,
    })
    .from(runs)
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .innerJoin(
      evaluationVersions,
      eq(runs.evaluationVersionId, evaluationVersions.id),
    )
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

async function loadBoundedScreenshot(runId: string) {
  const [artifact] = await getDb()
    .select({ objectKey: runArtifacts.objectKey, byteSize: runArtifacts.byteSize })
    .from(runArtifacts)
    .where(
      and(
        eq(runArtifacts.runId, runId),
        eq(runArtifacts.kind, "screenshot"),
      ),
    )
    .limit(1);
  if (!artifact || artifact.byteSize > 5 * 1024 * 1024) return null;
  const object = await env.UPLOADS.get(artifact.objectKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function buildJudgePrompt(input: {
  benchmarkPrompt: string;
  injectionFlag: boolean;
  objectiveRows: Array<typeof objectiveResults.$inferSelect>;
  rubric: Array<typeof rubricDimensions.$inferSelect>;
  untrustedEvidence: string;
}) {
  return canonicalJson(
    buildJudgePromptPayload({
      benchmarkPrompt: input.benchmarkPrompt,
      injectionFlag: input.injectionFlag,
      objectiveResults: input.objectiveRows,
      rubric: input.rubric,
      untrustedEvidence: input.untrustedEvidence,
    }),
  );
}

function inputObjectiveEvidence(
  rows: Array<typeof objectiveResults.$inferSelect>,
) {
  return rows.map((row) => ({
    checkKey: row.checkKey,
    dimensionKey: row.dimensionKey,
    metric: JSON.parse(row.metricValueJson) as unknown,
    scoreBps: row.scoreBps,
    status: row.status,
  }));
}

export async function callPinnedJudge(input: {
  endpointOrigin: string;
  maxTokens: number;
  model: string;
  prompt: string;
  screenshot: string | null;
}) {
  let origin: URL;
  try {
    origin = assertSafeProviderOrigin(input.endpointOrigin);
  } catch {
    throw new JudgeConfigurationError("judgeEndpointOrigin");
  }
  const endpoint = new URL("/v1/chat/completions", origin);
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: input.prompt },
  ];
  if (input.screenshot) {
    content.push({
      type: "image_url",
      image_url: { url: input.screenshot, detail: "high" },
    });
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredSecret("JUDGE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content }],
      max_completion_tokens: input.maxTokens,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new JudgeProviderError(response.status);
  const raw = providerResponseSchema.parse(await response.json());
  return {
    content: raw.choices[0].message.content,
    inputTokens: raw.usage?.prompt_tokens ?? null,
    outputTokens: raw.usage?.completion_tokens ?? null,
  };
}

function weightedObjectiveScore(
  rows: Array<typeof objectiveResults.$inferSelect>,
  fallback = 0,
) {
  if (rows.length === 0) return fallback;
  const weighted = rows.map((row) => {
    const metric = JSON.parse(row.metricValueJson) as { weightBps?: unknown };
    const weight =
      typeof metric.weightBps === "number" &&
      Number.isInteger(metric.weightBps) &&
      metric.weightBps > 0
        ? metric.weightBps
        : 1;
    return { score: row.scoreBps, weight };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return Math.round(
    weighted.reduce((sum, item) => sum + item.score * item.weight, 0) /
      totalWeight,
  );
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 4096) throw new JudgeConfigurationError(name);
  return value;
}

export class JudgeContractError extends Error {
  constructor(readonly code: string) {
    super("The pinned judge contract is unavailable.");
    this.name = "JudgeContractError";
  }
}

export class JudgeConfigurationError extends Error {
  constructor(readonly key: string) {
    super("The pinned judge is not configured.");
    this.name = "JudgeConfigurationError";
  }
}

export class JudgeProviderError extends Error {
  constructor(readonly status: number) {
    super("The pinned judge provider did not complete the request.");
    this.name = "JudgeProviderError";
  }
}
