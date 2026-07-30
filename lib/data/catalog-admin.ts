import { and, eq, sql } from "drizzle-orm";
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
  rubricDimensions,
  runs,
} from "@/db/schema";
import { allBenchmarks } from "@/benchmarks";
import {
  BENCHMAX_HARNESS_V1,
  EVALUATION_ENVIRONMENT_V1,
  JUDGE_PROTOCOL_TEMPLATE_V1,
  KIMI_K3_CONFIGURATION_LEVELS,
} from "@/lib/domain/ranked-catalog";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { assertSafeProviderOrigin } from "@/lib/security/run-policy";

export class CatalogConfigurationError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "CatalogConfigurationError";
  }
}

export async function seedRankedCatalog() {
  const judgeProvider = requiredRuntimeValue("JUDGE_PROVIDER");
  const judgeModel = requiredRuntimeValue("JUDGE_MODEL");
  const judgeModelVersion = requiredRuntimeValue("JUDGE_MODEL_VERSION");
  const judgeEndpointOrigin = requiredHttpsOrigin("JUDGE_API_ORIGIN");
  const e2bTemplateId = requiredRuntimeValue("E2B_TEMPLATE_ID");
  const now = new Date();
  const db = getDb();
  const dependencyPolicyJson = canonicalJson(
    BENCHMAX_HARNESS_V1.dependencyPolicy,
  );
  const filePolicyJson = canonicalJson(BENCHMAX_HARNESS_V1.filePolicy);
  const harnessContractHash = await canonicalSha256(BENCHMAX_HARNESS_V1);
  const toolsJson = canonicalJson(BENCHMAX_HARNESS_V1.tools);
  const templateBuildHash = requiredSha256("E2B_TEMPLATE_BUILD_HASH");
  const environmentHash = await canonicalSha256({
    evaluationPolicy: EVALUATION_ENVIRONMENT_V1,
    templateBuildHash,
    templateId: e2bTemplateId,
  });
  const dependencyHash = await canonicalSha256(
    BENCHMAX_HARNESS_V1.dependencyPolicy,
  );
  const judgePromptHash = await canonicalSha256(JUDGE_PROTOCOL_TEMPLATE_V1);
  const calibrationSetHash = requiredSha256("JUDGE_CALIBRATION_SET_HASH");
  requiredRuntimeValue("JUDGE_CALIBRATION_SET_OBJECT_KEY");

  await db
    .insert(providers)
    .values({
      id: "provider-moonshot",
      slug: "moonshot",
      name: "Moonshot AI",
      apiStyle: "openai-compatible",
      endpointOrigin: "https://api.moonshot.ai",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [storedProvider] = await db
    .select({
      apiStyle: providers.apiStyle,
      endpointOrigin: providers.endpointOrigin,
      name: providers.name,
      slug: providers.slug,
    })
    .from(providers)
    .where(eq(providers.id, "provider-moonshot"))
    .limit(1);
  if (!storedProvider) {
    throw new CatalogConfigurationError(
      "The Moonshot provider contract was not persisted.",
    );
  }
  const providerContractChanged =
    storedProvider.slug !== "moonshot" ||
    storedProvider.name !== "Moonshot AI" ||
    storedProvider.apiStyle !== "openai-compatible" ||
    storedProvider.endpointOrigin !== "https://api.moonshot.ai";
  if (providerContractChanged) {
    const [referenced] = await db
      .select({ value: sql<number>`count(*)` })
      .from(runs)
      .innerJoin(
        configurations,
        eq(runs.configurationId, configurations.id),
      )
      .where(eq(configurations.providerId, "provider-moonshot"));
    if (Number(referenced?.value ?? 0) > 0) {
      throw new CatalogConfigurationError(
        "The Moonshot provider execution contract is already referenced and cannot change in place.",
      );
    }
    await db
      .update(providers)
      .set({
        apiStyle: "openai-compatible",
        endpointOrigin: "https://api.moonshot.ai",
        name: "Moonshot AI",
        slug: "moonshot",
        updatedAt: now,
      })
      .where(eq(providers.id, "provider-moonshot"));
  }
  await db
    .insert(harnesses)
    .values({
      id: BENCHMAX_HARNESS_V1.id,
      slug: BENCHMAX_HARNESS_V1.slug,
      name: BENCHMAX_HARNESS_V1.name,
      version: BENCHMAX_HARNESS_V1.version,
      loopVersion: BENCHMAX_HARNESS_V1.loopVersion,
      toolsJson,
      filePolicyJson,
      contextBudgetTokens: BENCHMAX_HARNESS_V1.contextBudgetTokens,
      turnLimit: BENCHMAX_HARNESS_V1.turnLimit,
      dependencyPolicyJson,
      contractHash: harnessContractHash,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [storedHarness] = await db
    .select({
      contextBudgetTokens: harnesses.contextBudgetTokens,
      contractHash: harnesses.contractHash,
      dependencyPolicyJson: harnesses.dependencyPolicyJson,
      filePolicyJson: harnesses.filePolicyJson,
      loopVersion: harnesses.loopVersion,
      toolsJson: harnesses.toolsJson,
      turnLimit: harnesses.turnLimit,
    })
    .from(harnesses)
    .where(eq(harnesses.id, BENCHMAX_HARNESS_V1.id))
    .limit(1);
  if (!storedHarness) {
    throw new CatalogConfigurationError(
      "The Benchmax Web Agent harness was not persisted.",
    );
  }
  const harnessContractChanged =
    storedHarness.loopVersion !== BENCHMAX_HARNESS_V1.loopVersion ||
    storedHarness.toolsJson !== toolsJson ||
    storedHarness.filePolicyJson !== filePolicyJson ||
    storedHarness.contextBudgetTokens !==
      BENCHMAX_HARNESS_V1.contextBudgetTokens ||
    storedHarness.turnLimit !== BENCHMAX_HARNESS_V1.turnLimit ||
    storedHarness.dependencyPolicyJson !== dependencyPolicyJson ||
    storedHarness.contractHash !== harnessContractHash;
  if (harnessContractChanged) {
    const [referenced] = await db
      .select({ value: sql<number>`count(*)` })
      .from(benchmarkVersions)
      .where(eq(benchmarkVersions.harnessId, BENCHMAX_HARNESS_V1.id));
    if (Number(referenced?.value ?? 0) > 0) {
      throw new CatalogConfigurationError(
        "Benchmax Web Agent v1 is already referenced and its frozen contract changed. Create a new harness version before launch.",
      );
    }
    await db
      .update(harnesses)
      .set({
        contextBudgetTokens: BENCHMAX_HARNESS_V1.contextBudgetTokens,
        contractHash: harnessContractHash,
        dependencyPolicyJson,
        filePolicyJson,
        loopVersion: BENCHMAX_HARNESS_V1.loopVersion,
        toolsJson,
        turnLimit: BENCHMAX_HARNESS_V1.turnLimit,
        updatedAt: now,
      })
      .where(eq(harnesses.id, BENCHMAX_HARNESS_V1.id));
  }
  await db
    .insert(models)
    .values({
      id: "model-kimi-k3",
      slug: "kimi-k3",
      name: "Kimi K3",
      providerLabel: "Moonshot AI",
      providerId: "provider-moonshot",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [storedModel] = await db
    .select({
      name: models.name,
      providerId: models.providerId,
      providerLabel: models.providerLabel,
      slug: models.slug,
    })
    .from(models)
    .where(eq(models.id, "model-kimi-k3"))
    .limit(1);
  if (!storedModel) {
    throw new CatalogConfigurationError(
      "The Kimi K3 model identity was not persisted.",
    );
  }
  const modelIdentityChanged =
    storedModel.slug !== "kimi-k3" ||
    storedModel.name !== "Kimi K3" ||
    storedModel.providerLabel !== "Moonshot AI" ||
    storedModel.providerId !== "provider-moonshot";
  if (modelIdentityChanged) {
    const [referenced] = await db
      .select({ value: sql<number>`count(*)` })
      .from(runs)
      .innerJoin(
        configurations,
        eq(runs.configurationId, configurations.id),
      )
      .innerJoin(
        modelVersions,
        eq(configurations.modelVersionId, modelVersions.id),
      )
      .where(eq(modelVersions.modelId, "model-kimi-k3"));
    if (Number(referenced?.value ?? 0) > 0) {
      throw new CatalogConfigurationError(
        "The Kimi K3 model identity is already referenced and cannot change in place.",
      );
    }
    await db
      .update(models)
      .set({
        name: "Kimi K3",
        providerId: "provider-moonshot",
        providerLabel: "Moonshot AI",
        slug: "kimi-k3",
        updatedAt: now,
      })
      .where(eq(models.id, "model-kimi-k3"));
  }
  const kimiK3ReleaseDate = new Date("2026-07-27T00:00:00.000Z");
  await db
    .insert(modelVersions)
    .values({
      id: "model-version-kimi-k3-2026-07-27",
      modelId: "model-kimi-k3",
      versionLabel: "kimi-k3",
      releaseDate: kimiK3ReleaseDate,
      trainingCutoff: null,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [storedModelVersion] = await db
    .select({
      modelId: modelVersions.modelId,
      releaseDate: modelVersions.releaseDate,
      trainingCutoff: modelVersions.trainingCutoff,
      versionLabel: modelVersions.versionLabel,
    })
    .from(modelVersions)
    .where(eq(modelVersions.id, "model-version-kimi-k3-2026-07-27"))
    .limit(1);
  if (!storedModelVersion) {
    throw new CatalogConfigurationError(
      "The Kimi K3 model version contract was not persisted.",
    );
  }
  const modelVersionContractChanged =
    storedModelVersion.modelId !== "model-kimi-k3" ||
    storedModelVersion.versionLabel !== "kimi-k3" ||
    storedModelVersion.releaseDate?.getTime() !==
      kimiK3ReleaseDate.getTime() ||
    storedModelVersion.trainingCutoff !== null;
  if (modelVersionContractChanged) {
    const [referenced] = await db
      .select({ value: sql<number>`count(*)` })
      .from(runs)
      .innerJoin(
        configurations,
        eq(runs.configurationId, configurations.id),
      )
      .where(
        eq(
          configurations.modelVersionId,
          "model-version-kimi-k3-2026-07-27",
        ),
      );
    if (Number(referenced?.value ?? 0) > 0) {
      throw new CatalogConfigurationError(
        "The Kimi K3 model version is already referenced and cannot change in place.",
      );
    }
    await db
      .update(modelVersions)
      .set({
        modelId: "model-kimi-k3",
        releaseDate: kimiK3ReleaseDate,
        trainingCutoff: null,
        updatedAt: now,
        versionLabel: "kimi-k3",
      })
      .where(eq(modelVersions.id, "model-version-kimi-k3-2026-07-27"));
  }

  for (const reasoningLevel of KIMI_K3_CONFIGURATION_LEVELS) {
    const sampling = {
      max_completion_tokens: 65_536,
      reasoning_effort: reasoningLevel,
      stream: false,
      temperature: 0,
    };
    const configurationId = `config-kimi-k3-${reasoningLevel}-bwa1`;
    const samplingSettingsJson = canonicalJson(sampling);
    const settingsHash = await canonicalSha256(sampling);
    await db
      .insert(configurations)
      .values({
        id: configurationId,
        providerId: "provider-moonshot",
        modelVersionId: "model-version-kimi-k3-2026-07-27",
        harnessId: BENCHMAX_HARNESS_V1.id,
        endpointName: "Moonshot Chat Completions",
        providerModelId: "kimi-k3",
        reasoningLevel,
        samplingSettingsJson,
        settingsHash,
        maxOutputTokens: 65_536,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [storedConfiguration] = await db
      .select({
        endpointName: configurations.endpointName,
        harnessId: configurations.harnessId,
        maxOutputTokens: configurations.maxOutputTokens,
        modelVersionId: configurations.modelVersionId,
        providerId: configurations.providerId,
        providerModelId: configurations.providerModelId,
        reasoningLevel: configurations.reasoningLevel,
        samplingSettingsJson: configurations.samplingSettingsJson,
        settingsHash: configurations.settingsHash,
      })
      .from(configurations)
      .where(eq(configurations.id, configurationId))
      .limit(1);
    if (!storedConfiguration) {
      throw new CatalogConfigurationError(
        `Configuration ${configurationId} was not persisted.`,
      );
    }
    const configurationContractChanged =
      storedConfiguration.providerId !== "provider-moonshot" ||
      storedConfiguration.modelVersionId !==
        "model-version-kimi-k3-2026-07-27" ||
      storedConfiguration.harnessId !== BENCHMAX_HARNESS_V1.id ||
      storedConfiguration.endpointName !== "Moonshot Chat Completions" ||
      storedConfiguration.providerModelId !== "kimi-k3" ||
      storedConfiguration.reasoningLevel !== reasoningLevel ||
      storedConfiguration.samplingSettingsJson !== samplingSettingsJson ||
      storedConfiguration.settingsHash !== settingsHash ||
      storedConfiguration.maxOutputTokens !== 65_536;
    if (configurationContractChanged) {
      const [referenced] = await db
        .select({ value: sql<number>`count(*)` })
        .from(runs)
        .where(eq(runs.configurationId, configurationId));
      if (Number(referenced?.value ?? 0) > 0) {
        throw new CatalogConfigurationError(
          `Configuration ${configurationId} is already referenced and its frozen execution contract changed. Create a new configuration instead.`,
        );
      }
      await db
        .update(configurations)
        .set({
          endpointName: "Moonshot Chat Completions",
          harnessId: BENCHMAX_HARNESS_V1.id,
          maxOutputTokens: 65_536,
          modelVersionId: "model-version-kimi-k3-2026-07-27",
          providerId: "provider-moonshot",
          providerModelId: "kimi-k3",
          reasoningLevel,
          samplingSettingsJson,
          settingsHash,
          updatedAt: now,
        })
        .where(eq(configurations.id, configurationId));
    }
  }
  const expectedConfigurationIds = new Set(
    KIMI_K3_CONFIGURATION_LEVELS.map(
      (reasoningLevel) => `config-kimi-k3-${reasoningLevel}-bwa1`,
    ),
  );
  const unexpectedActiveConfigurations = await db
    .select({ id: configurations.id })
    .from(configurations)
    .where(
      and(
        eq(
          configurations.modelVersionId,
          "model-version-kimi-k3-2026-07-27",
        ),
        eq(configurations.harnessId, BENCHMAX_HARNESS_V1.id),
        eq(configurations.status, "active"),
      ),
    );
  for (const configuration of unexpectedActiveConfigurations) {
    if (expectedConfigurationIds.has(configuration.id)) continue;
    await db
      .update(configurations)
      .set({ status: "disabled", updatedAt: now })
      .where(eq(configurations.id, configuration.id));
  }

  const [existingEvaluation] = await db
    .select({
      calibrationSetHash: evaluationVersions.calibrationSetHash,
      driftThresholdBps: evaluationVersions.driftThresholdBps,
      endpointOrigin: evaluationVersions.endpointOrigin,
      id: evaluationVersions.id,
      judgeModel: evaluationVersions.judgeModel,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      judgeProvider: evaluationVersions.judgeProvider,
      maxTokensPerSample: evaluationVersions.maxTokensPerSample,
      promptTemplateHash: evaluationVersions.promptTemplateHash,
      rubricProtocolVersion: evaluationVersions.rubricProtocolVersion,
      sampleCount: evaluationVersions.sampleCount,
      status: evaluationVersions.status,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.version, 1))
    .limit(1);
  let evaluationVersionStatus:
    | "active"
    | "refreshed"
    | "unchanged" = existingEvaluation ? "unchanged" : "active";
  if (!existingEvaluation) {
    await db.insert(evaluationVersions).values({
      id: "evaluation-version-1",
      version: 1,
      judgeProvider,
      judgeModel,
      judgeModelVersion,
      endpointOrigin: judgeEndpointOrigin,
      promptTemplate: JUDGE_PROTOCOL_TEMPLATE_V1,
      promptTemplateHash: judgePromptHash,
      rubricProtocolVersion: "benchmax-rubric-v1",
      sampleCount: 3,
      maxTokensPerSample: 4096,
      calibrationSetHash,
      driftThresholdBps: 750,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    if (
      existingEvaluation.status === "frozen" ||
      existingEvaluation.status === "retired"
    ) {
      throw new CatalogConfigurationError(
        "Evaluation version 1 is no longer active. Create and calibrate a new pinned evaluation version before launching runs.",
      );
    }
    const evaluationContractChanged =
      existingEvaluation.judgeProvider !== judgeProvider ||
      existingEvaluation.judgeModel !== judgeModel ||
      existingEvaluation.judgeModelVersion !== judgeModelVersion ||
      existingEvaluation.endpointOrigin !== judgeEndpointOrigin ||
      existingEvaluation.promptTemplateHash !== judgePromptHash ||
      existingEvaluation.rubricProtocolVersion !== "benchmax-rubric-v1" ||
      existingEvaluation.sampleCount !== 3 ||
      existingEvaluation.maxTokensPerSample !== 4096 ||
      existingEvaluation.calibrationSetHash !== calibrationSetHash ||
      existingEvaluation.driftThresholdBps !== 750;
    const [referenced] = await db
      .select({ value: sql<number>`count(*)` })
      .from(runs)
      .where(eq(runs.evaluationVersionId, existingEvaluation.id));
    if (
      evaluationContractChanged &&
      Number(referenced?.value ?? 0) > 0
    ) {
      throw new CatalogConfigurationError(
        "Evaluation version 1 is already referenced and its pinned judge contract changed. Create a new evaluation version before launch.",
      );
    }
    if (evaluationContractChanged || existingEvaluation.status === "draft") {
      await db
        .update(evaluationVersions)
        .set({
          calibrationSetHash,
          driftThresholdBps: 750,
          endpointOrigin: judgeEndpointOrigin,
          judgeModel,
          judgeModelVersion,
          judgeProvider,
          maxTokensPerSample: 4096,
          promptTemplate: JUDGE_PROTOCOL_TEMPLATE_V1,
          promptTemplateHash: judgePromptHash,
          rubricProtocolVersion: "benchmax-rubric-v1",
          sampleCount: 3,
          status: "active",
          updatedAt: now,
        })
        .where(eq(evaluationVersions.id, existingEvaluation.id));
      evaluationVersionStatus = "refreshed";
    }
  }

  for (const { category, definition } of allBenchmarks) {
    const benchmarkId = `benchmark-${definition.slug}`;
    const benchmarkVersionId = definition.id;
    const harnessContractJson = canonicalJson(BENCHMAX_HARNESS_V1);
    const rubricJson = canonicalJson(definition.rubric);
    const interactionScriptHash = await canonicalSha256({
      viewport: definition.viewport,
      fixedClock: definition.fixedClock,
      seed: definition.seed,
      steps: definition.interactionSteps,
      checks: definition.checks,
    });
    await db
      .insert(benchmarks)
      .values({
        id: benchmarkId,
        slug: definition.slug,
        title: definition.title,
        category,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [storedBenchmark] = await db
      .select({
        category: benchmarks.category,
        slug: benchmarks.slug,
        title: benchmarks.title,
      })
      .from(benchmarks)
      .where(eq(benchmarks.id, benchmarkId))
      .limit(1);
    if (!storedBenchmark) {
      throw new CatalogConfigurationError(
        `Benchmark ${benchmarkId} was not persisted.`,
      );
    }
    const benchmarkIdentityChanged =
      storedBenchmark.slug !== definition.slug ||
      storedBenchmark.title !== definition.title ||
      storedBenchmark.category !== category;
    if (benchmarkIdentityChanged) {
      const [referenced] = await db
        .select({ value: sql<number>`count(*)` })
        .from(runs)
        .innerJoin(
          benchmarkVersions,
          eq(runs.benchmarkVersionId, benchmarkVersions.id),
        )
        .where(eq(benchmarkVersions.benchmarkId, benchmarkId));
      if (Number(referenced?.value ?? 0) > 0) {
        throw new CatalogConfigurationError(
          `Benchmark ${benchmarkId} is already referenced and its frozen identity changed. Create a new benchmark instead.`,
        );
      }
      await db
        .update(benchmarks)
        .set({
          category,
          slug: definition.slug,
          title: definition.title,
          updatedAt: now,
        })
        .where(eq(benchmarks.id, benchmarkId));
    }
    await db
      .insert(benchmarkVersions)
      .values({
        id: benchmarkVersionId,
        benchmarkId,
        version: definition.version,
        canonicalPrompt: definition.canonicalPrompt,
        rubricJson,
        harnessId: BENCHMAX_HARNESS_V1.id,
        harnessContractJson,
        environmentHash,
        objectiveWeightBps: 6000,
        judgeWeightBps: 4000,
        attemptPolicy: "pass@1",
        attemptCount: 1,
        dependencyLockHash: dependencyHash,
        interactionScriptHash,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [storedVersion] = await db
      .select({
        attemptCount: benchmarkVersions.attemptCount,
        attemptPolicy: benchmarkVersions.attemptPolicy,
        canonicalPrompt: benchmarkVersions.canonicalPrompt,
        dependencyLockHash: benchmarkVersions.dependencyLockHash,
        environmentHash: benchmarkVersions.environmentHash,
        harnessContractJson: benchmarkVersions.harnessContractJson,
        harnessId: benchmarkVersions.harnessId,
        interactionScriptHash: benchmarkVersions.interactionScriptHash,
        judgeWeightBps: benchmarkVersions.judgeWeightBps,
        objectiveWeightBps: benchmarkVersions.objectiveWeightBps,
        rubricJson: benchmarkVersions.rubricJson,
      })
      .from(benchmarkVersions)
      .where(eq(benchmarkVersions.id, benchmarkVersionId))
      .limit(1);
    if (!storedVersion) {
      throw new CatalogConfigurationError(
        `Benchmark version ${benchmarkVersionId} was not persisted.`,
      );
    }
    const [versionReference] = await db
      .select({ value: sql<number>`count(*)` })
      .from(runs)
      .where(eq(runs.benchmarkVersionId, benchmarkVersionId));
    const versionReferenceCount = Number(versionReference?.value ?? 0);
    const benchmarkContractChanged =
      storedVersion.canonicalPrompt !== definition.canonicalPrompt ||
      storedVersion.rubricJson !== rubricJson ||
      storedVersion.harnessId !== BENCHMAX_HARNESS_V1.id ||
      storedVersion.harnessContractJson !== harnessContractJson ||
      storedVersion.environmentHash !== environmentHash ||
      storedVersion.objectiveWeightBps !== 6000 ||
      storedVersion.judgeWeightBps !== 4000 ||
      storedVersion.attemptPolicy !== "pass@1" ||
      storedVersion.attemptCount !== 1 ||
      storedVersion.dependencyLockHash !== dependencyHash ||
      storedVersion.interactionScriptHash !== interactionScriptHash;
    if (benchmarkContractChanged && versionReferenceCount > 0) {
      throw new CatalogConfigurationError(
        `Benchmark version ${benchmarkVersionId} is already referenced and its frozen contract changed. Publish a new benchmark version instead.`,
      );
    }
    if (benchmarkContractChanged) {
      await db
        .update(benchmarkVersions)
        .set({
          attemptCount: 1,
          attemptPolicy: "pass@1",
          canonicalPrompt: definition.canonicalPrompt,
          dependencyLockHash: dependencyHash,
          environmentHash,
          harnessContractJson,
          harnessId: BENCHMAX_HARNESS_V1.id,
          interactionScriptHash,
          judgeWeightBps: 4000,
          objectiveWeightBps: 6000,
          rubricJson,
          updatedAt: now,
        })
        .where(eq(benchmarkVersions.id, benchmarkVersionId));
    }
    for (const [ordinal, dimension] of definition.rubric.entries()) {
      const dimensionId = `${benchmarkVersionId}:${dimension.key}`;
      const description =
        `${dimension.title} under the frozen frontend v1 protocol.`;
      const [storedDimension] = await db
        .select({
          description: rubricDimensions.description,
          judgeSourceRequired: rubricDimensions.judgeSourceRequired,
          mechanism: rubricDimensions.mechanism,
          ordinal: rubricDimensions.ordinal,
          title: rubricDimensions.title,
          weightBps: rubricDimensions.weightBps,
        })
        .from(rubricDimensions)
        .where(eq(rubricDimensions.id, dimensionId))
        .limit(1);
      const dimensionChanged =
        storedDimension &&
        (storedDimension.title !== dimension.title ||
          storedDimension.description !== description ||
          storedDimension.mechanism !== dimension.mechanism ||
          storedDimension.weightBps !== dimension.weightBps ||
          storedDimension.judgeSourceRequired !==
            dimension.judgeSourceRequired ||
          storedDimension.ordinal !== ordinal + 1);
      if ((!storedDimension || dimensionChanged) && versionReferenceCount > 0) {
        throw new CatalogConfigurationError(
          `Rubric dimension ${dimensionId} is already referenced and cannot be changed in place.`,
        );
      }
      if (!storedDimension) {
        await db.insert(rubricDimensions).values({
          id: dimensionId,
          benchmarkVersionId,
          key: dimension.key,
          title: dimension.title,
          description,
          mechanism: dimension.mechanism,
          weightBps: dimension.weightBps,
          judgeSourceRequired: dimension.judgeSourceRequired,
          ordinal: ordinal + 1,
          createdAt: now,
          updatedAt: now,
        });
      } else if (dimensionChanged) {
        await db
          .update(rubricDimensions)
          .set({
            description,
            judgeSourceRequired: dimension.judgeSourceRequired,
            mechanism: dimension.mechanism,
            ordinal: ordinal + 1,
            title: dimension.title,
            updatedAt: now,
            weightBps: dimension.weightBps,
          })
          .where(eq(rubricDimensions.id, dimensionId));
      }
    }
    const storedDimensionIds = await db
      .select({ id: rubricDimensions.id })
      .from(rubricDimensions)
      .where(eq(rubricDimensions.benchmarkVersionId, benchmarkVersionId));
    const expectedDimensionIds = new Set(
      definition.rubric.map(
        (dimension) => `${benchmarkVersionId}:${dimension.key}`,
      ),
    );
    const extraDimensionIds = storedDimensionIds
      .map((dimension) => dimension.id)
      .filter((id) => !expectedDimensionIds.has(id));
    if (extraDimensionIds.length > 0 && versionReferenceCount > 0) {
      throw new CatalogConfigurationError(
        `Benchmark version ${benchmarkVersionId} contains referenced rubric dimensions that are no longer part of its frozen contract.`,
      );
    }
    for (const extraDimensionId of extraDimensionIds) {
      await db
        .delete(rubricDimensions)
        .where(eq(rubricDimensions.id, extraDimensionId));
    }
  }

  const [[benchmarkCount], [configurationCount]] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(benchmarks),
    db
      .select({ value: sql<number>`count(*)` })
      .from(configurations)
      .where(eq(configurations.status, "active")),
  ]);
  return {
    benchmarkCount: Number(benchmarkCount?.value ?? 0),
    configurationCount: Number(configurationCount?.value ?? 0),
    evaluationVersionStatus,
  };
}

function requiredRuntimeValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.length > 200) {
    throw new CatalogConfigurationError(
      `Server configuration ${name} is required before catalog initialization.`,
    );
  }
  return value;
}

function requiredSha256(name: string): string {
  const value = requiredRuntimeValue(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new CatalogConfigurationError(
      `Server configuration ${name} must be a SHA-256 digest.`,
    );
  }
  return value;
}

function requiredHttpsOrigin(name: string): string {
  const value = requiredRuntimeValue(name);
  try {
    return assertSafeProviderOrigin(value).origin;
  } catch {
    throw new CatalogConfigurationError(
      `Server configuration ${name} must be a public HTTPS origin.`,
    );
  }
}
