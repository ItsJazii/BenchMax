import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  artifacts,
  dimensionScores,
  evaluationVersions,
  judgeSamples,
  objectiveResults,
  resultSpendRecords,
  resultConfigurations,
  rubricDimensions,
  runArtifacts,
  runs,
  showcases,
} from "@/db/schema";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { matchesMagicBytes } from "@/lib/security/artifact-inspection";
import { constantTimeEqualHex, sha256Hex } from "@/lib/security/policy";
import { transitionRun } from "@/lib/data/runs";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  buildJudgeSpendRecord,
  judgeRatesFromEnv,
  recordResultSpend,
} from "@/lib/data/result-spend";
import {
  imageDataUrl,
  planJudgeMedia,
  type PlannedJudgeImage,
} from "./media-evidence";
import {
  assertLiveJudgeModelIsImmutable,
  callPinnedJudge,
  JudgeConfigurationError,
} from "./provider";
import {
  buildJudgePromptPayload,
  createJudgeOutputSchema,
  evidenceSufficiencyConsensus,
  median,
  parseStoredJudgeOutputJson,
  prepareJudgeEvidence,
  selectResultEligibility,
  type JudgeOutput,
} from "./protocol";
import { requiresJudgeSource } from "./rubric-draft";
import { extractVideoEvidence } from "./video-frames";
import { judgeSampleTargetForStage } from "@/lib/pipeline/judge-dispatch";

export { callPinnedJudge } from "./provider";

export async function judgeRun(runId: string, stageVersion = "1") {
  const contract = await loadJudgeContract(runId);
  if (!contract) throw new JudgeContractError("missing_contract");
  if (contract.evaluationStatus !== "active") {
    throw new JudgeContractError("evaluation_not_active");
  }
  try {
    assertLiveJudgeModelIsImmutable(
      contract.judgeProvider,
      contract.judgeModelVersion,
    );
  } catch (error) {
    if (error instanceof JudgeConfigurationError) {
      // Immediate signal: without this, a wrongly-activated mutable alias
      // surfaces only as per-run terminal failures until the Monday
      // calibration cron freezes it.
      await appendAuditEvent({
        actorUserId: null,
        entityType: "evaluation_version",
        entityId: contract.evaluationVersionId,
        action: "judge.model_not_immutable",
        metadata: {
          judgeModelVersion: contract.judgeModelVersion,
          judgeProvider: contract.judgeProvider,
          runId,
        },
      });
      console.error(
        canonicalJson({
          alert: "judge_model_not_immutable",
          evaluationVersionId: contract.evaluationVersionId,
          runId,
          severity: "critical",
        }),
      );
      throw new JudgeContractError("judge_model_not_immutable");
    }
    throw error;
  }
  if (contract.runStatus === "evaluating") {
    await transitionRun({ id: runId, from: "evaluating", to: "judging" });
  } else if (
    contract.runStatus !== "judging" &&
    contract.runStatus !== "scored" &&
    contract.runStatus !== "published"
  ) {
    throw new JudgeContractError("invalid_run_state");
  }

  const evidence = await loadCommunityEvidence(
    runId,
    contract.showcaseId,
  );
  const sourceBytes = evidence.sourceBytes;

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
  const mediaEvidence = await loadJudgeMediaEvidence(
    runId,
    contract.evaluationVersionId,
  );
  const needsSource = judgeDimensions.some(
    requiresJudgeSource,
  );
  const objectiveEvidence = inputObjectiveEvidence(objectiveRows);
  const preparedEvidence = prepareJudgeEvidence({
    includeSource: needsSource,
    runtimeEvidence: [
      {
        label: "objective-runtime-results",
        value: objectiveEvidence,
      },
      {
        label: "submitted-evidence-manifest",
        value: evidence.manifest,
      },
      ...evidence.textEvidence,
      {
        label: "bounded-media-inspection",
        value: {
          ...mediaEvidence.manifest,
          videoInspection: mediaEvidence.videoInspection,
        },
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
    if (contract.showcaseId) {
      const nextJudgeStatus = "judging" as const;
      const nextRankingStatus = "moderation_hold" as const;
      await getDb()
        .update(showcases)
        .set({
          judgeStatus: nextJudgeStatus,
          rankingStatus: nextRankingStatus,
          updatedAt: new Date(),
        })
        .where(eq(showcases.id, contract.showcaseId));
      if (
        contract.showcaseJudgeStatus !== nextJudgeStatus ||
        contract.showcaseRankingStatus !== nextRankingStatus
      ) {
        await appendShowcaseJudgeAxisAudit({
          evidenceSufficient: null,
          nextJudgeStatus,
          nextRankingStatus,
          previousJudgeStatus: contract.showcaseJudgeStatus,
          previousRankingStatus: contract.showcaseRankingStatus,
          runId,
          sampleCount: 0,
          showcaseId: contract.showcaseId,
        });
      }
    }
  }
  const prompt = buildJudgePrompt({
    benchmarkPrompt: contract.benchmarkPrompt,
    injectionFlag: injection.flagged,
    objectiveRows,
    rubric: judgeDimensions,
    untrustedEvidence: preparedEvidence.untrustedEvidence,
  });
  const dimensionKeys = judgeDimensions.map((dimension) => dimension.key);
  const outputSchema = createJudgeOutputSchema(dimensionKeys);

  const samples: JudgeOutput[] = [];
  const sampleTarget = judgeSampleTargetForStage({
    credentialMode: contract.credentialMode,
    configuredSampleCount: contract.sampleCount,
    stageVersion,
  });
  for (let sampleIndex = 1; sampleIndex <= sampleTarget; sampleIndex += 1) {
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
      samples.push(
        parseStoredJudgeOutputJson(
          dimensionKeys,
          existing[0].structuredOutputJson,
        ),
      );
      continue;
    }
    const judgeRates = judgeRatesFromEnv();
    const startedAt = Date.now();
    const attemptNonce = crypto.randomUUID();
    let response: Awaited<ReturnType<typeof callPinnedJudge>>;
    try {
      response = await callPinnedJudge({
        endpointOrigin: contract.judgeEndpointOrigin,
        maxTokens: contract.maxTokensPerSample,
        model: contract.judgeModelVersion,
        prompt: `${contract.promptTemplate}\n\n${prompt}`,
        provider: contract.judgeProvider,
        images: mediaEvidence.images,
      });
    } catch (error) {
      await recordResultSpend(
        await buildJudgeSpendRecord({
          attemptKey: `judge:${runId}:${contract.evaluationVersionId}:${sampleIndex}:failed:${attemptNonce}`,
          durationMs: Math.max(0, Date.now() - startedAt),
          evaluationVersionId: contract.evaluationVersionId,
          inputTokens: null,
          outputTokens: null,
          runId,
          sampleIndex,
          status: "failed",
        }, judgeRates),
      );
      throw error;
    }
    let structured: JudgeOutput;
    try {
      structured = outputSchema.parse(JSON.parse(response.content));
    } catch (error) {
      await recordResultSpend(
        await buildJudgeSpendRecord({
          attemptKey: `judge:${runId}:${contract.evaluationVersionId}:${sampleIndex}:invalid:${attemptNonce}`,
          durationMs: Math.max(0, Date.now() - startedAt),
          evaluationVersionId: contract.evaluationVersionId,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          runId,
          sampleIndex,
          status: "failed",
        }, judgeRates),
      );
      throw error;
    }
    const structuredOutputJson = canonicalJson(structured);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const judgeSample = {
      id: crypto.randomUUID(),
      runId,
      evaluationVersionId: contract.evaluationVersionId,
      sampleIndex,
      structuredOutputJson,
      responseHash: await canonicalSha256(structured),
      injectionFlag: injection.flagged,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs,
      createdAt: new Date(),
    } satisfies typeof judgeSamples.$inferInsert;
    const spendRecord = await buildJudgeSpendRecord(
      {
        attemptKey: `judge:${runId}:${contract.evaluationVersionId}:${sampleIndex}:completed:${attemptNonce}`,
        durationMs,
        evaluationVersionId: contract.evaluationVersionId,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        runId,
        sampleIndex,
        status: "completed",
      },
      judgeRates,
    );
    const db = getDb();
    await db.batch([
      db.insert(judgeSamples).values(judgeSample).onConflictDoNothing(),
      db.insert(resultSpendRecords).values(spendRecord).onConflictDoNothing(),
    ]);
    samples.push(structured);
  }

  const evidenceSufficient = evidenceSufficiencyConsensus(
    samples.map((sample) => ({
      evidenceSufficient: sample.evidence_sufficient,
    })),
  );
  const currentSafetyStatus = contract.showcaseId
    ? (
        await getDb()
          .select({ safetyStatus: showcases.safetyStatus })
          .from(showcases)
          .where(eq(showcases.id, contract.showcaseId))
          .limit(1)
      )[0]?.safetyStatus ?? null
    : "approved";
  const eligibility = selectResultEligibility({
    catalogCanonical: contract.catalogStatus === "canonical",
    evidenceSufficient,
    injectionFlag: injection.flagged,
    safetyApproved:
      !contract.showcaseId || currentSafetyStatus === "approved",
  });
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: runId,
    action: "judge.evidence_sufficiency_decided",
    metadata: {
      evidenceSufficient,
      sampleCount: samples.length,
      sufficientSampleCount: samples.filter(
        (sample) => sample.evidence_sufficient,
      ).length,
    },
  });

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
      .onConflictDoUpdate({
        target: [
          dimensionScores.runId,
          dimensionScores.rubricDimensionId,
        ],
        set: {
          objectiveScoreBps:
            dimension.mechanism === "judge" ? null : dimensionObjective,
          judgeMedianScoreBps: dimensionJudge,
          originalCombinedScoreBps: combined,
          reasoning:
            judgeReasoning.get(dimension.key) ??
            "Computed from the frozen objective checks.",
          updatedAt: new Date(),
        },
      });
  }
  if (contract.runStatus === "evaluating" || contract.runStatus === "judging") {
    await transitionRun({
      id: runId,
      from: "judging",
      to: "scored",
      patch: {
        overallScoreBps,
        rankEligible: eligibility.rankEligible,
        scoredAt: new Date(),
      },
    });
  } else {
    await getDb()
      .update(runs)
      .set({
        overallScoreBps,
        rankEligible: eligibility.rankEligible,
        scoredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId));
  }
  if (contract.showcaseId) {
    const previousJudgeStatus = injection.flagged
      ? "judging"
      : contract.showcaseJudgeStatus;
    const previousRankingStatus = injection.flagged
      ? "moderation_hold"
      : contract.showcaseRankingStatus;
    await getDb()
      .update(showcases)
      .set({
        judgeStatus: "scored",
        rankingStatus: eligibility.rankingStatus,
        updatedAt: new Date(),
      })
      .where(eq(showcases.id, contract.showcaseId));
    if (
      previousJudgeStatus !== "scored" ||
      previousRankingStatus !== eligibility.rankingStatus
    ) {
      await appendShowcaseJudgeAxisAudit({
        evidenceSufficient,
        nextJudgeStatus: "scored",
        nextRankingStatus: eligibility.rankingStatus,
        previousJudgeStatus,
        previousRankingStatus,
        runId,
        sampleCount: samples.length,
        showcaseId: contract.showcaseId,
      });
    }
  }
  return {
    evidenceSufficient,
    injectionFlag: injection.flagged,
    overallScoreBps,
  };
}

async function loadJudgeContract(runId: string) {
  const [row] = await getDb()
    .select({
      benchmarkPrompt: benchmarkVersions.canonicalPrompt,
      benchmarkVersionId: benchmarkVersions.id,
      catalogStatus: resultConfigurations.catalogStatus,
      credentialMode: runs.credentialMode,
      evaluationStatus: evaluationVersions.status,
      evaluationVersionId: evaluationVersions.id,
      judgeEndpointOrigin: evaluationVersions.endpointOrigin,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      judgeProvider: evaluationVersions.judgeProvider,
      judgeWeightBps: benchmarkVersions.judgeWeightBps,
      maxTokensPerSample: evaluationVersions.maxTokensPerSample,
      objectiveWeightBps: benchmarkVersions.objectiveWeightBps,
      promptTemplate: evaluationVersions.promptTemplate,
      runStatus: runs.status,
      sampleCount: evaluationVersions.sampleCount,
      showcaseId: runs.showcaseId,
      showcaseJudgeStatus: showcases.judgeStatus,
      showcaseRankingStatus: showcases.rankingStatus,
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
    .leftJoin(showcases, eq(showcases.id, runs.showcaseId))
    .leftJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .where(eq(runs.id, runId))
    .limit(1);
  return row ?? null;
}

async function appendShowcaseJudgeAxisAudit(input: {
  evidenceSufficient: boolean | null;
  nextJudgeStatus: string;
  nextRankingStatus: string;
  previousJudgeStatus: string | null;
  previousRankingStatus: string | null;
  runId: string;
  sampleCount: number;
  showcaseId: string;
}) {
  await appendAuditEvent({
    actorUserId: null,
    entityType: "showcase",
    entityId: input.showcaseId,
    action: "showcase.judge_axes_changed",
    metadata: {
      evidenceSufficient: input.evidenceSufficient,
      judgeStatus: {
        from: input.previousJudgeStatus,
        to: input.nextJudgeStatus,
      },
      rankingStatus: {
        from: input.previousRankingStatus,
        to: input.nextRankingStatus,
      },
      runId: input.runId,
      sampleCount: input.sampleCount,
    },
  });
}

async function loadCommunityEvidence(
  runId: string,
  showcaseId: string | null,
) {
  if (!showcaseId) {
    const [source] = await getDb()
      .select({
        contentType: runArtifacts.contentType,
        objectKey: runArtifacts.objectKey,
      })
      .from(runArtifacts)
      .where(
        and(
          eq(runArtifacts.runId, runId),
          eq(runArtifacts.kind, "generated-source"),
        ),
      )
      .limit(1);
    const sourceObject = source
      ? await env.UPLOADS.get(source.objectKey)
      : null;
    return {
      manifest: [],
      sourceBytes: sourceObject
        ? new Uint8Array(await sourceObject.arrayBuffer())
        : null,
      textEvidence: [],
    };
  }
  const rows = await getDb()
    .select({
      byteSize: artifacts.byteSize,
      contentType: artifacts.contentType,
      createdAt: artifacts.createdAt,
      id: artifacts.id,
      kind: artifacts.kind,
      objectKey: artifacts.objectKey,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.showcaseId, showcaseId),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    )
    .orderBy(artifacts.createdAt, artifacts.id);
  let sourceBytes: Uint8Array | null = null;
  const textEvidence: Array<{ label: string; value: unknown }> = [];
  for (const [index, row] of rows.entries()) {
    if (row.byteSize > 20 * 1024 * 1024) continue;
    if (
      row.kind === "source" &&
      ["application/zip", "application/x-zip-compressed"].includes(
        row.contentType,
      )
    ) {
      const object = await env.UPLOADS.get(row.objectKey);
      if (object && sourceBytes === null) {
        sourceBytes = new Uint8Array(await object.arrayBuffer());
      }
    } else if (
      (row.kind === "source" || row.kind === "log") &&
      (row.contentType.startsWith("text/") ||
        row.contentType === "application/json" ||
        row.contentType === "application/x-ndjson")
    ) {
      const object = await env.UPLOADS.get(row.objectKey);
      if (object) {
        textEvidence.push({
          label: `submitted-${row.kind}-${index + 1}`,
          value: (await object.text()).slice(0, 80_000),
        });
      }
    }
  }
  return {
    manifest: rows.map(({ byteSize, contentType, kind }) => ({
      byteSize,
      contentType,
      kind,
    })),
    sourceBytes,
    textEvidence,
  };
}

async function loadJudgeMediaEvidence(
  runId: string,
  evaluationVersionId: string,
) {
  const rows = await getDb()
    .select({
      byteSize: runArtifacts.byteSize,
      contentType: runArtifacts.contentType,
      createdAt: runArtifacts.createdAt,
      id: runArtifacts.id,
      kind: runArtifacts.kind,
      objectKey: runArtifacts.objectKey,
      sha256: runArtifacts.sha256,
    })
    .from(runArtifacts)
    .where(eq(runArtifacts.runId, runId))
    .orderBy(runArtifacts.createdAt, runArtifacts.id);
  const plan = planJudgeMedia(rows);
  const images: string[] = [];
  for (const image of plan.images) {
    images.push(await loadImageEvidence(image));
  }
  const video = await extractVideoEvidence({
    evaluationVersionId,
    getObject: (objectKey) => env.UPLOADS.get(objectKey),
    runId,
    videos: plan.videos,
  });
  return {
    images: [...images, ...video.images],
    manifest: plan.manifest,
    videoInspection: video.inspection,
  };
}

async function loadImageEvidence(image: PlannedJudgeImage) {
  const object = await env.UPLOADS.get(image.objectKey);
  if (
    !object ||
    object.size !== image.byteSize ||
    object.httpMetadata?.contentType !== image.contentType
  ) {
    throw new JudgeContractError("image_evidence_integrity_mismatch");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sha256 = await sha256Hex(bytes.slice().buffer);
  if (
    bytes.byteLength !== image.byteSize ||
    !matchesMagicBytes(image.contentType, bytes.subarray(0, 64)) ||
    !constantTimeEqualHex(sha256, image.sha256)
  ) {
    throw new JudgeContractError("image_evidence_integrity_mismatch");
  }
  return imageDataUrl(bytes, image.contentType);
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

export class JudgeContractError extends Error {
  constructor(readonly code: string) {
    super("The pinned judge contract is unavailable.");
    this.name = "JudgeContractError";
  }
}
