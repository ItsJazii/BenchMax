import { eq, sql } from "drizzle-orm";
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
} from "@/db/schema";
import { allBenchmarks } from "@/benchmarks";
import {
  BENCHMAX_HARNESS_V1,
  EVALUATION_ENVIRONMENT_V1,
  JUDGE_PROTOCOL_TEMPLATE_V1,
} from "@/lib/domain/ranked-catalog";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { assertSafeProviderOrigin } from "@/lib/security/run-policy";

const MODEL_FAMILIES = [
  ["openai", "OpenAI", "GPT"],
  ["anthropic", "Anthropic", "Claude"],
  ["google", "Google", "Gemini"],
  ["moonshot", "Moonshot AI", "Kimi"],
  ["z-ai", "Z.ai", "GLM"],
  ["minimax", "MiniMax", "MiniMax"],
  ["alibaba", "Alibaba", "Qwen"],
  ["deepseek", "DeepSeek", "DeepSeek"],
] as const;

const COMMUNITY_HARNESSES = [
  "Cursor",
  "Codex",
  "Claude Code",
  "Cline",
  "aider",
  "Custom",
] as const;

export class CatalogConfigurationError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "CatalogConfigurationError";
  }
}

export async function seedRankedCatalog() {
  const now = new Date();
  const db = getDb();
  const judgeProvider = requiredRuntimeValue("JUDGE_PROVIDER");
  const judgeModel = requiredRuntimeValue("JUDGE_MODEL");
  const judgeModelVersion = requiredRuntimeValue("JUDGE_MODEL_VERSION");
  const judgeEndpointOrigin = requiredHttpsOrigin("JUDGE_API_ORIGIN");
  const templateBuildHash = requiredSha256("E2B_TEMPLATE_BUILD_HASH");
  const calibrationSetHash = requiredSha256("JUDGE_CALIBRATION_SET_HASH");
  requiredRuntimeValue("JUDGE_CALIBRATION_SET_OBJECT_KEY");

  for (const [slug, providerName, modelName] of MODEL_FAMILIES) {
    const providerId = `provider-metadata-${slug}`;
    const modelId = `model-${slug}`;
    const modelVersionId = `model-version-${slug}-unspecified`;
    await db
      .insert(providers)
      .values({
        id: providerId,
        slug: `metadata-${slug}`,
        name: providerName,
        apiStyle: "openai-compatible",
        endpointOrigin: `https://${slug}.metadata.benchmax.invalid`,
        status: "disabled",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await db
      .insert(models)
      .values({
        id: modelId,
        slug,
        name: modelName,
        providerLabel: providerName,
        providerId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await db
      .insert(modelVersions)
      .values({
        id: modelVersionId,
        modelId,
        versionLabel: "Unspecified",
        releaseDate: null,
        trainingCutoff: null,
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  for (const name of COMMUNITY_HARNESSES) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const contract = {
      purpose: "community-declared-metadata",
      name,
      version: 1,
    };
    await db
      .insert(harnesses)
      .values({
        id: `harness-community-${slug}`,
        slug,
        name,
        version: 1,
        loopVersion: "declared",
        toolsJson: "[]",
        filePolicyJson: "{}",
        contextBudgetTokens: 1,
        turnLimit: 1,
        dependencyPolicyJson: "{}",
        contractHash: await canonicalSha256(contract),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  const evaluatorHarnessHash = await canonicalSha256(BENCHMAX_HARNESS_V1);
  await db
    .insert(harnesses)
    .values({
      id: BENCHMAX_HARNESS_V1.id,
      slug: BENCHMAX_HARNESS_V1.slug,
      name: BENCHMAX_HARNESS_V1.name,
      version: BENCHMAX_HARNESS_V1.version,
      loopVersion: BENCHMAX_HARNESS_V1.loopVersion,
      toolsJson: canonicalJson(BENCHMAX_HARNESS_V1.tools),
      filePolicyJson: canonicalJson(BENCHMAX_HARNESS_V1.filePolicy),
      contextBudgetTokens: BENCHMAX_HARNESS_V1.contextBudgetTokens,
      turnLimit: BENCHMAX_HARNESS_V1.turnLimit,
      dependencyPolicyJson: canonicalJson(BENCHMAX_HARNESS_V1.dependencyPolicy),
      contractHash: evaluatorHarnessHash,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(providers)
    .values({
      id: "provider-community-submission",
      slug: "community-submission",
      name: "Community declared",
      apiStyle: "openai-compatible",
      endpointOrigin: "https://submission.metadata.benchmax.invalid",
      status: "disabled",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(models)
    .values({
      id: "model-community-submission",
      slug: "community-submission",
      name: "Community submission",
      providerLabel: "Community declared",
      providerId: "provider-community-submission",
      status: "archived",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(modelVersions)
    .values({
      id: "model-version-community-submission",
      modelId: "model-community-submission",
      versionLabel: "Declared evidence",
      releaseDate: null,
      trainingCutoff: null,
      isCurrent: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(configurations)
    .values({
      id: "configuration-community-submission",
      providerId: "provider-community-submission",
      modelVersionId: "model-version-community-submission",
      harnessId: BENCHMAX_HARNESS_V1.id,
      endpointName: "No tested-model endpoint",
      providerModelId: "community-submission",
      reasoningLevel: "low",
      samplingSettingsJson: "{}",
      settingsHash: await canonicalSha256({ type: "community-submission" }),
      maxOutputTokens: 1,
      status: "disabled",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const promptTemplateHash = await canonicalSha256(JUDGE_PROTOCOL_TEMPLATE_V1);
  await db
    .insert(evaluationVersions)
    .values({
      id: "evaluation-version-1",
      version: 1,
      judgeProvider,
      judgeModel,
      judgeModelVersion,
      endpointOrigin: judgeEndpointOrigin,
      promptTemplate: JUDGE_PROTOCOL_TEMPLATE_V1,
      promptTemplateHash,
      rubricProtocolVersion: "benchmax-community-rubric-v1",
      sampleCount: 3,
      maxTokensPerSample: 4096,
      calibrationSetHash,
      driftThresholdBps: 750,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const environmentHash = await canonicalSha256({
    evaluationPolicy: EVALUATION_ENVIRONMENT_V1,
    templateBuildHash,
    templateId: requiredRuntimeValue("E2B_TEMPLATE_ID"),
  });
  const dependencyHash = await canonicalSha256(
    BENCHMAX_HARNESS_V1.dependencyPolicy,
  );

  for (const { category, definition } of allBenchmarks) {
    const benchmarkId = `benchmark-${definition.slug}`;
    await db
      .insert(benchmarks)
      .values({
        id: benchmarkId,
        creatorId: null,
        slug: definition.slug,
        title: definition.title,
        goal: definition.canonicalPrompt,
        successCriteriaJson: canonicalJson(
          definition.rubric.map((dimension) => dimension.title),
        ),
        category,
        status: "active",
        rubricStatus: "approved",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await db
      .insert(benchmarkVersions)
      .values({
        id: definition.id,
        benchmarkId,
        version: definition.version,
        title: definition.title,
        goal: definition.canonicalPrompt,
        successCriteriaJson: canonicalJson(
          definition.rubric.map((dimension) => dimension.title),
        ),
        category,
        canonicalPrompt: definition.canonicalPrompt,
        rubricJson: canonicalJson(definition.rubric),
        harnessId: BENCHMAX_HARNESS_V1.id,
        harnessContractJson: canonicalJson(BENCHMAX_HARNESS_V1),
        environmentHash,
        objectiveWeightBps: 6000,
        judgeWeightBps: 4000,
        attemptPolicy: "pass@1",
        attemptCount: 1,
        dependencyLockHash: dependencyHash,
        interactionScriptHash: await canonicalSha256({
          checks: definition.checks,
          steps: definition.interactionSteps,
        }),
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    for (const [index, dimension] of definition.rubric.entries()) {
      await db
        .insert(rubricDimensions)
        .values({
          id: `${definition.id}:${dimension.key}`,
          benchmarkVersionId: definition.id,
          key: dimension.key,
          title: dimension.title,
          description: dimension.title,
          mechanism: dimension.mechanism,
          weightBps: dimension.weightBps,
          judgeSourceRequired: dimension.judgeSourceRequired,
          ordinal: index + 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }

  const [[benchmarkCount], [modelCount], [harnessCount]] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(benchmarks),
    db.select({ value: sql<number>`count(*)` }).from(models),
    db.select({ value: sql<number>`count(*)` }).from(harnesses),
  ]);
  const [evaluation] = await db
    .select({ status: evaluationVersions.status })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.id, "evaluation-version-1"))
    .limit(1);
  return {
    benchmarkCount: Number(benchmarkCount?.value ?? 0),
    configurationCount: 0,
    modelCount: Number(modelCount?.value ?? 0),
    harnessCount: Number(harnessCount?.value ?? 0),
    evaluationVersionStatus: evaluation?.status ?? "missing",
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
  try {
    return assertSafeProviderOrigin(requiredRuntimeValue(name)).origin;
  } catch {
    throw new CatalogConfigurationError(
      `Server configuration ${name} must be a public HTTPS origin.`,
    );
  }
}
