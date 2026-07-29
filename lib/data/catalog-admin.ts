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
  KIMI_K3_CONFIGURATION_LEVELS,
} from "@/lib/domain/ranked-catalog";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";

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
  const e2bTemplateId = requiredRuntimeValue("E2B_TEMPLATE_ID");
  const now = new Date();
  const db = getDb();
  const harnessContractHash = await canonicalSha256(BENCHMAX_HARNESS_V1);
  const environmentContract = {
    ...EVALUATION_ENVIRONMENT_V1,
    e2bTemplateId,
  };
  const environmentHash = await canonicalSha256(environmentContract);
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
      dependencyPolicyJson: canonicalJson(
        BENCHMAX_HARNESS_V1.dependencyPolicy,
      ),
      contractHash: harnessContractHash,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
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
  await db
    .insert(modelVersions)
    .values({
      id: "model-version-kimi-k3-2026-07-27",
      modelId: "model-kimi-k3",
      versionLabel: "kimi-k3",
      releaseDate: new Date("2026-07-27T00:00:00.000Z"),
      trainingCutoff: null,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  for (const reasoningLevel of KIMI_K3_CONFIGURATION_LEVELS) {
    const sampling = {
      max_completion_tokens: 65_536,
      reasoning_effort: reasoningLevel,
      stream: false,
      temperature: 0,
    };
    const settingsHash = await canonicalSha256(sampling);
    await db
      .insert(configurations)
      .values({
        id: `config-kimi-k3-${reasoningLevel}-bwa1`,
        providerId: "provider-moonshot",
        modelVersionId: "model-version-kimi-k3-2026-07-27",
        harnessId: BENCHMAX_HARNESS_V1.id,
        endpointName: "Moonshot Chat Completions",
        providerModelId: "kimi-k3",
        reasoningLevel,
        samplingSettingsJson: canonicalJson(sampling),
        settingsHash,
        maxOutputTokens: 65_536,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  const [existingEvaluation] = await db
    .select({ id: evaluationVersions.id })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.version, 1))
    .limit(1);
  if (!existingEvaluation) {
    await db.insert(evaluationVersions).values({
      id: "evaluation-version-1",
      version: 1,
      judgeProvider,
      judgeModel,
      judgeModelVersion,
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
  }

  for (const { category, definition } of allBenchmarks) {
    const benchmarkId = `benchmark-${definition.slug}`;
    const benchmarkVersionId = definition.id;
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
    await db
      .insert(benchmarkVersions)
      .values({
        id: benchmarkVersionId,
        benchmarkId,
        version: definition.version,
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
        interactionScriptHash,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    for (const [ordinal, dimension] of definition.rubric.entries()) {
      await db
        .insert(rubricDimensions)
        .values({
          id: `${benchmarkVersionId}:${dimension.key}`,
          benchmarkVersionId,
          key: dimension.key,
          title: dimension.title,
          description: `${dimension.title} under the frozen frontend v1 protocol.`,
          mechanism: dimension.mechanism,
          weightBps: dimension.weightBps,
          judgeSourceRequired: dimension.judgeSourceRequired,
          ordinal: ordinal + 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
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
    evaluationVersionStatus: existingEvaluation ? "unchanged" : "active",
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
