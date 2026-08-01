import { and, desc, eq, ne } from "drizzle-orm";
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
  legacyGenerationRecords,
  runArtifacts,
  objectiveResults,
  dimensionScores,
  rubricDimensions,
} from "@/db/schema";
import {
  isAllowedRunTransition,
  type RunStatus,
} from "@/lib/security/run-policy";
import { appendAuditEvent } from "@/lib/data/audit";

export async function getOwnedRun(id: string, contributorId: string) {
  const [run] = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.contributorId, contributorId)))
    .limit(1);
  return run ?? null;
}

export async function transitionRun(input: {
  actorUserId?: string | null;
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
  await appendAuditEvent({
    actorUserId: input.actorUserId ?? null,
    entityType: "run",
    entityId: input.id,
    action: "run.status_transitioned",
    metadata: {
      from: input.from,
      patchFields: Object.keys(input.patch ?? {}).sort(),
      to: input.to,
    },
  });
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
      benchmark: benchmarkVersions.title,
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
      category: benchmarkVersions.category,
      benchmark: benchmarkVersions.title,
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
        ne(runs.credentialMode, "community-submission"),
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
      benchmark: benchmarkVersions.title,
      benchmarkVersion: benchmarkVersions.version,
      benchmarkPublishedAt: benchmarkVersions.publishedAt,
      prompt: benchmarkVersions.canonicalPrompt,
      model: models.name,
      modelVersion: modelVersions.versionLabel,
      provider: providers.name,
      reasoningLevel: configurations.reasoningLevel,
      endpointName: configurations.endpointName,
      settingsHash: configurations.settingsHash,
      harness: harnesses.name,
      harnessVersion: harnesses.version,
      evaluationVersion: evaluationVersions.version,
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
    .innerJoin(harnesses, eq(configurations.harnessId, harnesses.id))
    .innerJoin(
      evaluationVersions,
      eq(runs.evaluationVersionId, evaluationVersions.id),
    )
    .innerJoin(
      modelVersions,
      eq(configurations.modelVersionId, modelVersions.id),
    )
    .innerJoin(models, eq(modelVersions.modelId, models.id))
    .where(
      and(
        eq(runs.publicSlug, slug),
        eq(runs.status, "published"),
        ne(runs.credentialMode, "community-submission"),
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
        ne(runs.credentialMode, "community-submission"),
        eq(runArtifacts.id, artifactId),
        eq(runArtifacts.public, true),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return artifact ?? null;
}

export async function getPublicLegacyRunEvidence(runId: string) {
  const [provenance, artifacts, objective, dimensions] =
    await Promise.all([
      getDb()
        .select({
          requestHash: legacyGenerationRecords.requestHash,
          responseHash: legacyGenerationRecords.responseHash,
          provenanceHash: legacyGenerationRecords.provenanceHash,
        })
        .from(legacyGenerationRecords)
        .where(eq(legacyGenerationRecords.runId, runId))
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
    ]);
  return {
    provenance: provenance[0] ?? null,
    artifacts,
    objective,
    dimensions,
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
