import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  catalogRequests,
  harnesses,
  judgeSamples,
  models,
  modelVersions,
  resultConfigurations,
  runs,
  showcases,
} from "@/db/schema";
import { canonicalSha256 } from "@/lib/security/canonical";
import { slugify } from "@/lib/security/policy";
import { resultConfigurationIdentityMaterial } from "@/lib/data/result-metadata";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  evidenceSufficiencyConsensus,
  parseStoredEvidenceGateJson,
  selectResultEligibility,
} from "@/lib/judging/protocol";

export async function listPendingCatalogRequests() {
  return getDb()
    .select({
      id: catalogRequests.id,
      kind: catalogRequests.kind,
      requestedLabel: catalogRequests.requestedLabel,
      createdAt: catalogRequests.createdAt,
      resultConfigurationId: catalogRequests.resultConfigurationId,
      modelLabel: resultConfigurations.modelLabel,
      modelVersionLabel: resultConfigurations.modelVersionLabel,
      harnessLabel: resultConfigurations.harnessLabel,
    })
    .from(catalogRequests)
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, catalogRequests.resultConfigurationId),
    )
    .where(eq(catalogRequests.status, "pending"))
    .orderBy(desc(catalogRequests.createdAt));
}

export async function resolveCatalogRequest(input: {
  action: "approve" | "reject";
  modelId?: string;
  requestId: string;
  reviewerUserId: string;
}) {
  const [request] = await getDb()
    .select({
      id: catalogRequests.id,
      kind: catalogRequests.kind,
      status: catalogRequests.status,
      resultConfigurationId: catalogRequests.resultConfigurationId,
      modelLabel: resultConfigurations.modelLabel,
      modelVersionLabel: resultConfigurations.modelVersionLabel,
      harnessLabel: resultConfigurations.harnessLabel,
    })
    .from(catalogRequests)
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, catalogRequests.resultConfigurationId),
    )
    .where(eq(catalogRequests.id, input.requestId))
    .limit(1);
  if (!request || request.status !== "pending") {
    throw new CatalogRequestConflictError();
  }
  if (!request.resultConfigurationId) {
    throw new CatalogRequestConflictError();
  }
  const now = new Date();
  if (input.action === "reject") {
    const affectedRuns = await getDb()
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(showcases, eq(showcases.id, runs.showcaseId))
      .where(
        eq(showcases.resultConfigurationId, request.resultConfigurationId),
      );
    await getDb()
      .update(catalogRequests)
      .set({
        status: "rejected",
        reviewedByUserId: input.reviewerUserId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(catalogRequests.id, request.id));
    await getDb()
      .update(resultConfigurations)
      .set({ catalogStatus: "rejected", updatedAt: now })
      .where(eq(resultConfigurations.id, request.resultConfigurationId));
    await getDb()
      .update(showcases)
      .set({ rankingStatus: "ineligible", updatedAt: now })
      .where(
        eq(showcases.resultConfigurationId, request.resultConfigurationId),
      );
    await getDb()
      .update(runs)
      .set({ rankEligible: false, updatedAt: now })
      .where(
        inArray(
          runs.id,
          affectedRuns.map((run) => run.id),
        ),
      );
    for (const run of affectedRuns) {
      await enqueueCatalogEligibilityPublish(
        run.id,
        "rejected",
        input.reviewerUserId,
      );
    }
    return { status: "rejected" as const };
  }

  let mappedEntityId: string;
  if (request.kind === "model-version") {
    if (!input.modelId) throw new CatalogRequestModelRequiredError();
    const [model] = await getDb()
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.id, input.modelId), eq(models.status, "active")))
      .limit(1);
    if (!model) throw new CatalogRequestModelRequiredError();
    const [existing] = await getDb()
      .select({ id: modelVersions.id })
      .from(modelVersions)
      .where(
        and(
          eq(modelVersions.modelId, model.id),
          eq(modelVersions.versionLabel, request.modelVersionLabel),
        ),
      )
      .limit(1);
    mappedEntityId = existing?.id ?? `model-version-${crypto.randomUUID()}`;
    if (!existing) {
      await getDb().insert(modelVersions).values({
        id: mappedEntityId,
        modelId: model.id,
        versionLabel: request.modelVersionLabel,
        releaseDate: null,
        trainingCutoff: null,
        isCurrent: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    await getDb()
      .update(resultConfigurations)
      .set({ modelVersionId: mappedEntityId, updatedAt: now })
      .where(eq(resultConfigurations.id, request.resultConfigurationId));
  } else if (request.kind === "harness") {
    const contract = {
      purpose: "community-declared-metadata",
      label: request.harnessLabel,
      version: 1,
    };
    const contractHash = await canonicalSha256(contract);
    const [existing] = await getDb()
      .select({ id: harnesses.id })
      .from(harnesses)
      .where(eq(harnesses.contractHash, contractHash))
      .limit(1);
    mappedEntityId = existing?.id ?? `harness-community-${crypto.randomUUID()}`;
    if (!existing) {
      await getDb().insert(harnesses).values({
        id: mappedEntityId,
        slug: `${slugify(request.harnessLabel)}-${mappedEntityId.slice(-8)}`,
        name: request.harnessLabel,
        version: 1,
        loopVersion: "declared",
        toolsJson: "[]",
        filePolicyJson: "{}",
        contextBudgetTokens: 1,
        turnLimit: 1,
        dependencyPolicyJson: "{}",
        contractHash,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await getDb()
      .update(resultConfigurations)
      .set({ harnessId: mappedEntityId, updatedAt: now })
      .where(eq(resultConfigurations.id, request.resultConfigurationId));
  } else {
    throw new CatalogRequestConflictError();
  }

  await getDb()
    .update(catalogRequests)
    .set({
      status: "mapped",
      mappedEntityId,
      reviewedByUserId: input.reviewerUserId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(catalogRequests.id, request.id));

  const [configuration] = await getDb()
    .select({
      modelVersionId: resultConfigurations.modelVersionId,
      harnessId: resultConfigurations.harnessId,
    })
    .from(resultConfigurations)
    .where(eq(resultConfigurations.id, request.resultConfigurationId))
    .limit(1);
  const [blockingRequest] = await getDb()
    .select({ id: catalogRequests.id })
    .from(catalogRequests)
    .where(
      and(
        eq(
          catalogRequests.resultConfigurationId,
          request.resultConfigurationId,
        ),
        ne(catalogRequests.status, "mapped"),
      ),
    )
    .limit(1);
  if (
    configuration?.modelVersionId &&
    configuration.harnessId &&
    !blockingRequest
  ) {
    const canonicalConfigurationId = await canonicalizeResultConfiguration(
      request.resultConfigurationId,
      now,
    );
    const resultRows = await getDb()
      .select({
        showcaseId: showcases.id,
        judgeStatus: showcases.judgeStatus,
        rankingStatus: showcases.rankingStatus,
        safetyStatus: showcases.safetyStatus,
        runId: runs.id,
        runStatus: runs.status,
        injectionFlag: runs.injectionFlag,
        evaluationVersionId: runs.evaluationVersionId,
      })
      .from(showcases)
      .leftJoin(runs, eq(runs.showcaseId, showcases.id))
      .where(
        eq(showcases.resultConfigurationId, canonicalConfigurationId),
      );
    for (const row of resultRows) {
      const scored = row.judgeStatus === "scored";
      const safe = row.safetyStatus === "approved";
      const evidenceSufficient =
        scored && row.runId && row.evaluationVersionId
          ? await storedRunEvidenceSufficiency(
              row.runId,
              row.evaluationVersionId,
            )
          : false;
      const eligibility = selectResultEligibility({
        catalogCanonical: true,
        evidenceSufficient,
        injectionFlag: Boolean(row.injectionFlag),
        safetyApproved: safe,
      });
      await getDb()
        .update(showcases)
        .set({
          rankingStatus: scored ? eligibility.rankingStatus : "pending",
          updatedAt: now,
        })
        .where(eq(showcases.id, row.showcaseId));
      const nextRankingStatus = scored
        ? eligibility.rankingStatus
        : "pending";
      if (row.rankingStatus !== nextRankingStatus) {
        await appendAuditEvent({
          actorUserId: input.reviewerUserId,
          entityType: "showcase",
          entityId: row.showcaseId,
          action: "showcase.ranking_gate_recomputed",
          metadata: {
            evidenceSufficient,
            judgeStatus: row.judgeStatus,
            rankingStatus: {
              from: row.rankingStatus,
              to: nextRankingStatus,
            },
            runId: row.runId,
            trigger: "catalog_mapped",
          },
        });
      }
      if (
        scored &&
        safe &&
        row.runId &&
        row.runStatus &&
        ["scored", "published"].includes(row.runStatus)
      ) {
        const updatedRuns = await getDb()
          .update(runs)
          .set({ rankEligible: eligibility.rankEligible, updatedAt: now })
          .where(
            and(
              eq(runs.id, row.runId),
              inArray(runs.status, ["scored", "published"]),
            ),
          )
          .returning({ id: runs.id });
        if (updatedRuns.length > 0 && eligibility.rankEligible) {
          await enqueueCatalogEligibilityPublish(
            row.runId,
            "approved",
            input.reviewerUserId,
          );
        }
      }
    }
  }
  return { status: "mapped" as const, mappedEntityId };
}

async function storedRunEvidenceSufficiency(
  runId: string,
  evaluationVersionId: string,
) {
  const samples = await getDb()
    .select({ structuredOutputJson: judgeSamples.structuredOutputJson })
    .from(judgeSamples)
    .where(
      and(
        eq(judgeSamples.runId, runId),
        eq(judgeSamples.evaluationVersionId, evaluationVersionId),
      ),
    )
    .orderBy(judgeSamples.sampleIndex);
  return evidenceSufficiencyConsensus(
    samples.map((sample) =>
      parseStoredEvidenceGateJson(sample.structuredOutputJson),
    ),
  );
}

async function canonicalizeResultConfiguration(
  configurationId: string,
  now: Date,
) {
  const [configuration] = await getDb()
    .select()
    .from(resultConfigurations)
    .where(eq(resultConfigurations.id, configurationId))
    .limit(1);
  if (!configuration?.modelVersionId || !configuration.harnessId) {
    throw new CatalogRequestConflictError();
  }
  const declaredSettings = JSON.parse(configuration.declaredSettingsJson) as unknown;
  const metadataHash = await canonicalSha256(
    resultConfigurationIdentityMaterial({
      declaredSettings,
      harnessId: configuration.harnessId,
      harnessLabel: configuration.harnessLabel,
      modelLabel: configuration.modelLabel,
      modelVersionId: configuration.modelVersionId,
      modelVersionLabel: configuration.modelVersionLabel,
      reasoningNormalized: configuration.reasoningNormalized,
    }),
  );
  const [existing] = await getDb()
    .select({ id: resultConfigurations.id })
    .from(resultConfigurations)
    .where(
      and(
        ne(resultConfigurations.id, configuration.id),
        eq(
          resultConfigurations.modelVersionId,
          configuration.modelVersionId,
        ),
        eq(resultConfigurations.harnessId, configuration.harnessId),
        eq(
          resultConfigurations.reasoningNormalized,
          configuration.reasoningNormalized,
        ),
        eq(
          resultConfigurations.declaredSettingsJson,
          configuration.declaredSettingsJson,
        ),
        eq(resultConfigurations.catalogStatus, "canonical"),
      ),
    )
    .limit(1);
  if (existing) {
    await getDb().batch([
      getDb()
        .update(showcases)
        .set({ resultConfigurationId: existing.id, updatedAt: now })
        .where(eq(showcases.resultConfigurationId, configuration.id)),
      getDb()
        .update(catalogRequests)
        .set({ resultConfigurationId: existing.id, updatedAt: now })
        .where(eq(catalogRequests.resultConfigurationId, configuration.id)),
      getDb()
        .delete(resultConfigurations)
        .where(eq(resultConfigurations.id, configuration.id)),
    ]);
    return existing.id;
  }
  await getDb()
    .update(resultConfigurations)
    .set({ catalogStatus: "canonical", metadataHash, updatedAt: now })
    .where(eq(resultConfigurations.id, configuration.id));
  return configuration.id;
}

async function enqueueCatalogEligibilityPublish(
  runId: string,
  reason: "approved" | "rejected",
  actorUserId: string,
) {
  const { env } = await import("cloudflare:workers");
  try {
    await env.JUDGE_QUEUE.send({
      runId,
      stage: "publish",
      stageVersion: `catalog-${reason}-${crypto.randomUUID()}`,
    });
  } catch (error) {
    await appendAuditEvent({
      actorUserId,
      entityType: "run",
      entityId: runId,
      action: "run.publish_refresh_deferred",
      metadata: {
        catalogDecision: reason,
        errorName: error instanceof Error ? error.name : "UnknownError",
        stage: "publish",
      },
    });
  }
}

export class CatalogRequestConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("This catalog request cannot be resolved in its current state.");
    this.name = "CatalogRequestConflictError";
  }
}

export class CatalogRequestModelRequiredError extends Error {
  readonly status = 400;
  constructor() {
    super("Choose the canonical model family for this exact model version.");
    this.name = "CatalogRequestModelRequiredError";
  }
}
