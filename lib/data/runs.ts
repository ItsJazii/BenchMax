import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  benchmarks,
  configurations,
  evaluationVersions,
  harnesses,
  models,
  modelVersions,
  providers,
  runs,
  users,
  generationRecords,
  runArtifacts,
  objectiveResults,
  dimensionScores,
  rubricDimensions,
  judgeSamples,
} from "@/db/schema";
import type { z } from "zod";
import {
  isAllowedRunTransition,
  runDraftSchema,
  type RunStatus,
} from "@/lib/security/run-policy";

export async function listRunLaunchCatalog() {
  const benchmarkRows = await getDb()
    .select({
      id: benchmarkVersions.id,
      title: benchmarks.title,
      slug: benchmarks.slug,
      category: benchmarks.category,
      version: benchmarkVersions.version,
      attemptPolicy: benchmarkVersions.attemptPolicy,
      attemptCount: benchmarkVersions.attemptCount,
      environmentHash: benchmarkVersions.environmentHash,
      publishedAt: benchmarkVersions.publishedAt,
    })
    .from(benchmarkVersions)
    .innerJoin(benchmarks, eq(benchmarkVersions.benchmarkId, benchmarks.id))
    .where(
      eq(benchmarks.status, "active"),
    )
    .orderBy(benchmarks.title, benchmarkVersions.version);
  const configurationRows = await getDb()
    .select({
      id: configurations.id,
      provider: providers.name,
      providerSlug: providers.slug,
      model: models.name,
      modelVersion: modelVersions.versionLabel,
      endpointName: configurations.endpointName,
      reasoningLevel: configurations.reasoningLevel,
      settingsHash: configurations.settingsHash,
      harness: harnesses.name,
      harnessVersion: harnesses.version,
    })
    .from(configurations)
    .innerJoin(providers, eq(configurations.providerId, providers.id))
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(models, eq(modelVersions.modelId, models.id))
    .innerJoin(harnesses, eq(configurations.harnessId, harnesses.id))
    .where(
      and(
        eq(configurations.status, "active"),
        eq(providers.status, "active"),
        eq(models.status, "active"),
        eq(harnesses.status, "active"),
      ),
    )
    .orderBy(models.name, configurations.reasoningLevel);
  const [evaluation] = await getDb()
    .select({
      id: evaluationVersions.id,
      version: evaluationVersions.version,
      judgeModel: evaluationVersions.judgeModel,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.status, "active"))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  return {
    benchmarks: benchmarkRows,
    configurations: configurationRows,
    evaluation: evaluation ?? null,
  };
}

export async function createRunDraft(
  contributorId: string,
  input: z.infer<typeof runDraftSchema>,
) {
  const parsed = runDraftSchema.parse(input);
  const db = getDb();
  const [contract] = await db
    .select({
      benchmarkVersionId: benchmarkVersions.id,
      benchmarkPublishedAt: benchmarkVersions.publishedAt,
      environmentHash: benchmarkVersions.environmentHash,
      benchmarkHarnessId: benchmarkVersions.harnessId,
      attemptPolicy: benchmarkVersions.attemptPolicy,
      attemptCount: benchmarkVersions.attemptCount,
      category: benchmarks.category,
      configurationId: configurations.id,
      configurationHarnessId: configurations.harnessId,
      harnessContractHash: harnesses.contractHash,
      trainingCutoff: modelVersions.trainingCutoff,
      evaluationVersionId: evaluationVersions.id,
    })
    .from(benchmarkVersions)
    .innerJoin(benchmarks, eq(benchmarkVersions.benchmarkId, benchmarks.id))
    .innerJoin(
      configurations,
      eq(configurations.id, parsed.configurationId),
    )
    .innerJoin(harnesses, eq(configurations.harnessId, harnesses.id))
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(
      evaluationVersions,
      eq(evaluationVersions.status, "active"),
    )
    .where(
      and(
        eq(benchmarkVersions.id, parsed.benchmarkVersionId),
        eq(benchmarks.status, "active"),
        eq(configurations.status, "active"),
        eq(harnesses.status, "active"),
      ),
    )
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  if (!contract) throw new RunContractError("Run contract is unavailable.");
  if (contract.benchmarkHarnessId !== contract.configurationHarnessId) {
    throw new RunContractError(
      "The model configuration does not use this benchmark's frozen harness.",
    );
  }
  if (
    contract.attemptPolicy !== "pass@1" ||
    contract.attemptCount !== 1
  ) {
    throw new RunContractError(
      "The v1 run launcher only accepts the frozen pass@1 protocol.",
    );
  }

  const now = new Date();
  const id = crypto.randomUUID();
  const postPublicationMarker = Boolean(
    contract.trainingCutoff &&
      contract.benchmarkPublishedAt &&
      contract.trainingCutoff > contract.benchmarkPublishedAt,
  );
  const [run] = await db
    .insert(runs)
    .values({
      id,
      publicSlug: `run-${id.slice(0, 12)}`,
      contributorId,
      benchmarkVersionId: contract.benchmarkVersionId,
      configurationId: contract.configurationId,
      evaluationVersionId: contract.evaluationVersionId,
      credentialMode: parsed.credentialMode,
      status: "draft",
      attemptIndex: 1,
      passGroupId: id,
      environmentHash: contract.environmentHash,
      harnessContractHash: contract.harnessContractHash,
      postPublicationMarker,
      rankEligible: false,
      playableEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return run;
}

export async function getOwnedRun(id: string, contributorId: string) {
  const [run] = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.contributorId, contributorId)))
    .limit(1);
  return run ?? null;
}

export async function transitionRun(input: {
  from: RunStatus;
  id: string;
  patch?: Partial<typeof runs.$inferInsert>;
  to: RunStatus;
}) {
  if (!isAllowedRunTransition(input.from, input.to)) {
    throw new RunTransitionError(input.from, input.to);
  }
  const [updated] = await getDb()
    .update(runs)
    .set({
      ...input.patch,
      status: input.to,
      updatedAt: new Date(),
    })
    .where(and(eq(runs.id, input.id), eq(runs.status, input.from)))
    .returning();
  if (!updated) throw new RunTransitionConflictError();
  return updated;
}

export async function listRunsForOwner(contributorId: string) {
  return getDb()
    .select({
      id: runs.id,
      publicSlug: runs.publicSlug,
      status: runs.status,
      score: runs.overallScoreBps,
      createdAt: runs.createdAt,
      benchmark: benchmarks.title,
      model: models.name,
      reasoningLevel: configurations.reasoningLevel,
    })
    .from(runs)
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .innerJoin(benchmarks, eq(benchmarkVersions.benchmarkId, benchmarks.id))
    .innerJoin(
      configurations,
      eq(runs.configurationId, configurations.id),
    )
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(models, eq(modelVersions.modelId, models.id))
    .where(eq(runs.contributorId, contributorId))
    .orderBy(desc(runs.createdAt))
    .limit(100);
}

export async function listRecentPublicRuns(limit = 24) {
  return getDb()
    .select({
      id: runs.id,
      publicSlug: runs.publicSlug,
      overallScoreBps: runs.overallScoreBps,
      publishedAt: runs.publishedAt,
      category: benchmarks.category,
      benchmark: benchmarks.title,
      benchmarkSlug: benchmarks.slug,
      benchmarkVersion: benchmarkVersions.version,
      model: models.name,
      modelVersion: modelVersions.versionLabel,
      provider: providers.name,
      endpointName: configurations.endpointName,
      reasoningLevel: configurations.reasoningLevel,
      settingsHash: configurations.settingsHash,
      harness: harnesses.name,
      harnessVersion: harnesses.version,
      contributorHandle: users.handle,
      postPublicationMarker: runs.postPublicationMarker,
    })
    .from(runs)
    .innerJoin(users, eq(runs.contributorId, users.id))
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .innerJoin(benchmarks, eq(benchmarkVersions.benchmarkId, benchmarks.id))
    .innerJoin(
      configurations,
      eq(runs.configurationId, configurations.id),
    )
    .innerJoin(harnesses, eq(configurations.harnessId, harnesses.id))
    .innerJoin(providers, eq(configurations.providerId, providers.id))
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(models, eq(modelVersions.modelId, models.id))
    .where(
      and(
        eq(runs.status, "published"),
        eq(runs.rankEligible, true),
        eq(users.status, "active"),
      ),
    )
    .orderBy(desc(runs.publishedAt), desc(runs.id))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getPublicRunBySlug(slug: string) {
  const [run] = await getDb()
    .select({
      id: runs.id,
      publicSlug: runs.publicSlug,
      status: runs.status,
      overallScoreBps: runs.overallScoreBps,
      environmentHash: runs.environmentHash,
      harnessContractHash: runs.harnessContractHash,
      injectionFlag: runs.injectionFlag,
      outputContentHash: runs.outputContentHash,
      postPublicationMarker: runs.postPublicationMarker,
      playableEnabled: runs.playableEnabled,
      createdAt: runs.createdAt,
      generatedAt: runs.generatedAt,
      evaluatedAt: runs.evaluatedAt,
      scoredAt: runs.scoredAt,
      publishedAt: runs.publishedAt,
      benchmark: benchmarks.title,
      benchmarkVersion: benchmarkVersions.version,
      benchmarkPublishedAt: benchmarkVersions.publishedAt,
      prompt: benchmarkVersions.canonicalPrompt,
      model: models.name,
      modelVersion: modelVersions.versionLabel,
      provider: providers.name,
      reasoningLevel: configurations.reasoningLevel,
      endpointName: configurations.endpointName,
      settingsHash: configurations.settingsHash,
      contributorHandle: users.handle,
    })
    .from(runs)
    .innerJoin(users, eq(runs.contributorId, users.id))
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .innerJoin(benchmarks, eq(benchmarkVersions.benchmarkId, benchmarks.id))
    .innerJoin(
      configurations,
      eq(runs.configurationId, configurations.id),
    )
    .innerJoin(providers, eq(configurations.providerId, providers.id))
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(models, eq(modelVersions.modelId, models.id))
    .where(
      and(
        eq(runs.publicSlug, slug),
        eq(runs.status, "published"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return run ?? null;
}

export async function getPublicRunArtifact(
  publicSlug: string,
  artifactId: string,
) {
  const [artifact] = await getDb()
    .select({
      id: runArtifacts.id,
      kind: runArtifacts.kind,
      objectKey: runArtifacts.objectKey,
      contentType: runArtifacts.contentType,
      byteSize: runArtifacts.byteSize,
      sha256: runArtifacts.sha256,
    })
    .from(runArtifacts)
    .innerJoin(runs, eq(runArtifacts.runId, runs.id))
    .innerJoin(users, eq(runs.contributorId, users.id))
    .where(
      and(
        eq(runs.publicSlug, publicSlug),
        eq(runs.status, "published"),
        eq(runs.rankEligible, true),
        eq(runArtifacts.id, artifactId),
        eq(runArtifacts.public, true),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return artifact ?? null;
}

export async function getPublicRunEvidence(runId: string) {
  const [provenance, artifacts, objective, dimensions, samples] =
    await Promise.all([
      getDb()
        .select({
          requestHash: generationRecords.requestHash,
          responseHash: generationRecords.responseHash,
          provenanceHash: generationRecords.provenanceHash,
          redactedTranscript: generationRecords.redactedTranscript,
          inputTokens: generationRecords.inputTokens,
          outputTokens: generationRecords.outputTokens,
          durationMs: generationRecords.durationMs,
          turnCount: generationRecords.harnessTurnCount,
        })
        .from(generationRecords)
        .where(eq(generationRecords.runId, runId))
        .limit(1),
      getDb()
        .select({
          id: runArtifacts.id,
          kind: runArtifacts.kind,
          contentType: runArtifacts.contentType,
          byteSize: runArtifacts.byteSize,
          sha256: runArtifacts.sha256,
        })
        .from(runArtifacts)
        .where(
          and(eq(runArtifacts.runId, runId), eq(runArtifacts.public, true)),
        )
        .orderBy(runArtifacts.kind),
      getDb()
        .select({
          checkKey: objectiveResults.checkKey,
          dimensionKey: objectiveResults.dimensionKey,
          metricValueJson: objectiveResults.metricValueJson,
          scoreBps: objectiveResults.scoreBps,
          status: objectiveResults.status,
        })
        .from(objectiveResults)
        .where(eq(objectiveResults.runId, runId))
        .orderBy(objectiveResults.checkKey),
      getDb()
        .select({
          key: rubricDimensions.key,
          title: rubricDimensions.title,
          mechanism: rubricDimensions.mechanism,
          objectiveScoreBps: dimensionScores.objectiveScoreBps,
          judgeMedianScoreBps: dimensionScores.judgeMedianScoreBps,
          originalCombinedScoreBps: dimensionScores.originalCombinedScoreBps,
          adjustedCombinedScoreBps: dimensionScores.adjustedCombinedScoreBps,
          reasoning: dimensionScores.reasoning,
        })
        .from(dimensionScores)
        .innerJoin(
          rubricDimensions,
          eq(dimensionScores.rubricDimensionId, rubricDimensions.id),
        )
        .where(eq(dimensionScores.runId, runId))
        .orderBy(rubricDimensions.ordinal),
      getDb()
        .select({
          sampleIndex: judgeSamples.sampleIndex,
          structuredOutputJson: judgeSamples.structuredOutputJson,
          responseHash: judgeSamples.responseHash,
          injectionFlag: judgeSamples.injectionFlag,
        })
        .from(judgeSamples)
        .where(eq(judgeSamples.runId, runId))
        .orderBy(judgeSamples.sampleIndex),
    ]);
  return {
    provenance: provenance[0] ?? null,
    artifacts,
    objective,
    dimensions,
    samples,
  };
}

export class RunContractError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "RunContractError";
  }
}

export class RunTransitionError extends Error {
  readonly status = 400;
  constructor(from: string, to: string) {
    super(`Run cannot transition from ${from} to ${to}.`);
    this.name = "RunTransitionError";
  }
}

export class RunTransitionConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("Run state changed before this operation completed.");
    this.name = "RunTransitionConflictError";
  }
}
