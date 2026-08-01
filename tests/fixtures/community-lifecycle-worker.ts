import { zipSync, strToU8 } from "fflate";
import { eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../db";
import {
  artifacts,
  benchmarkVersions,
  benchmarks,
  configurations,
  evaluationVersions,
  harnesses,
  models,
  modelVersions,
  providers,
  rubricDimensions,
  showcases,
  users,
  runs,
  catalogRequests,
  resultConfigurations,
  judgeSamples,
} from "../../db/schema";
import { createShowcaseDraft } from "../../lib/data/showcases";
import { publishShowcase } from "../../lib/data/showcases";
import { queuePublishedResult } from "../../lib/data/results";
import { judgeRun } from "../../lib/judging/judge-run";
import { resolveCatalogRequest } from "../../lib/data/catalog-requests";
import { canonicalJson } from "../../lib/security/canonical";
import { sha256Hex } from "../../lib/security/policy";

const CONTRIBUTOR_ID = "lifecycle-contributor";
const PROVIDER_ID = "lifecycle-provider";
const MODEL_ID = "lifecycle-model";
const JUDGE_MODEL_VERSION_ID = "lifecycle-judge-model-v1";
const HARNESS_ID = "lifecycle-harness";
const BENCHMARK_ID = "lifecycle-benchmark";
const BENCHMARK_VERSION_ID = "lifecycle-benchmark-v1";
const EVALUATION_ID = "lifecycle-evaluation-v1";
const CONFIGURATION_ID = "configuration-community-submission";

const rubric = [
  {
    key: "task-success",
    title: "Task success",
    description: "The submitted result completes the requested task.",
    mechanism: "judge" as const,
    weightBps: 4_000,
    judgeSourceRequired: true,
  },
  {
    key: "correctness",
    title: "Correctness",
    description: "The submitted result behaves correctly under the test.",
    mechanism: "judge" as const,
    weightBps: 3_500,
    judgeSourceRequired: true,
  },
  {
    key: "quality",
    title: "Quality",
    description: "The submitted result is clear and appropriately polished.",
    mechanism: "judge" as const,
    weightBps: 2_500,
    judgeSourceRequired: false,
  },
];

const judgeOutput = JSON.stringify({
  evidence_sufficient: true,
  evidence_sufficiency_reason: "The submitted source directly supports every required dimension.",
  dimensions: rubric.map((dimension) => ({
    key: dimension.key,
    score_bps: 9_000,
    reasoning: "The fixture source and the published test evidence support this score.",
  })),
});

const originalFetch = globalThis.fetch;

function installJudgeStub() {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "judge.example.test") {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        messages?: unknown[];
      };
      if (request.model !== "judge-snapshot-v1" || !request.messages?.length) {
        return new Response("unexpected judge request", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: judgeOutput } }],
          usage: { prompt_tokens: 12, completion_tokens: 24 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

async function seedDatabase() {
  const db = getDb();
  const now = new Date("2026-08-01T00:00:00.000Z");
  const rubricJson = canonicalJson(rubric);

  await db.batch([
    db.insert(users).values({
      id: CONTRIBUTOR_ID,
      authSubject: "lifecycle-auth",
      handle: "lifecycle-user",
      displayName: "Lifecycle User",
      role: "contributor",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(providers).values({
      id: PROVIDER_ID,
      slug: "lifecycle-provider",
      name: "Lifecycle Provider",
      apiStyle: "openai-compatible",
      endpointOrigin: "https://provider.example.test",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(models).values({
      id: MODEL_ID,
      slug: "lifecycle-model",
      name: "Lifecycle Model",
      providerLabel: "Lifecycle Provider",
      providerId: PROVIDER_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(harnesses).values({
      id: HARNESS_ID,
      slug: "lifecycle-harness",
      name: "Lifecycle Harness",
      version: 1,
      loopVersion: "test-v1",
      toolsJson: "[]",
      filePolicyJson: "{}",
      contextBudgetTokens: 1000,
      turnLimit: 1,
      dependencyPolicyJson: "{}",
      contractHash: "lifecycle-harness-contract",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(benchmarks).values({
      id: BENCHMARK_ID,
      creatorId: CONTRIBUTOR_ID,
      slug: "lifecycle-benchmark",
      title: "Lifecycle Benchmark",
      goal: "Exercise the community result lifecycle end to end.",
      successCriteriaJson: JSON.stringify(["The lifecycle completes."]),
      category: "frontend",
      status: "active",
      rubricStatus: "approved",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(benchmarkVersions).values({
      id: BENCHMARK_VERSION_ID,
      benchmarkId: BENCHMARK_ID,
      version: 1,
      title: "Lifecycle Benchmark",
      goal: "Exercise the community result lifecycle end to end.",
      successCriteriaJson: JSON.stringify(["The lifecycle completes."]),
      category: "frontend",
      canonicalPrompt: "Build the exact lifecycle fixture.",
      rubricJson,
      harnessId: HARNESS_ID,
      harnessContractJson: "{}",
      environmentHash: "lifecycle-environment",
      objectiveWeightBps: 0,
      judgeWeightBps: 10_000,
      attemptPolicy: "pass@1",
      attemptCount: 1,
      dependencyLockHash: "lifecycle-dependencies",
      interactionScriptHash: "lifecycle-interaction",
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(rubricDimensions).values(
      rubric.map((dimension, index) => ({
        id: `${BENCHMARK_VERSION_ID}:${dimension.key}`,
        benchmarkVersionId: BENCHMARK_VERSION_ID,
        key: dimension.key,
        title: dimension.title,
        description: dimension.description,
        mechanism: dimension.mechanism,
        weightBps: dimension.weightBps,
        judgeSourceRequired: dimension.judgeSourceRequired,
        ordinal: index + 1,
        createdAt: now,
        updatedAt: now,
      })),
    ),
    db.insert(evaluationVersions).values({
      id: EVALUATION_ID,
      version: 1,
      judgeProvider: "lifecycle-provider",
      judgeModel: "lifecycle-judge",
      judgeModelVersion: "judge-snapshot-v1",
      endpointOrigin: "https://judge.example.test",
      promptTemplate: "Judge the frozen evidence.",
      promptTemplateHash: "lifecycle-prompt-hash",
      rubricProtocolVersion: "community-rubric-v1",
      sampleCount: 3,
      maxTokensPerSample: 200,
      calibrationSetHash: "lifecycle-calibration",
      driftThresholdBps: 100,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  await db
    .update(benchmarkVersions)
    .set({ publishedAt: now, updatedAt: now })
    .where(eq(benchmarkVersions.id, BENCHMARK_VERSION_ID));

  await db.batch([
    db.insert(modelVersions).values({
      id: JUDGE_MODEL_VERSION_ID,
      modelId: MODEL_ID,
      versionLabel: "judge-v1",
      releaseDate: null,
      trainingCutoff: null,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  await db.insert(configurations).values({
    id: CONFIGURATION_ID,
    providerId: PROVIDER_ID,
    modelVersionId: JUDGE_MODEL_VERSION_ID,
    harnessId: HARNESS_ID,
    endpointName: "community-submission",
    providerModelId: "community-submission",
    reasoningLevel: "medium",
    samplingSettingsJson: "{}",
    settingsHash: "lifecycle-settings",
    maxOutputTokens: 1000,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function runLifecycle() {
  installJudgeStub();
  await seedDatabase();
  const db = getDb();

  const draft = await createShowcaseDraft(CONTRIBUTOR_ID, {
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    title: "Unknown model lifecycle",
    summary: "A real community result lifecycle fixture for catalog approval.",
    category: "frontend",
    modelLabel: "Lifecycle Model",
    modelVersionLabel: "2026.08-preview",
    harness: "Lifecycle Harness v1",
    harnessId: HARNESS_ID,
    reasoningLevel: "medium",
    declaredSettings: { temperature: 0 },
    prompt: "Build the exact lifecycle fixture.",
    systemPrompt: "",
    sourceVisibility: "public",
    rightsConfirmed: true,
  });
  const resultConfigurationId = draft.resultConfigurationId;
  if (!resultConfigurationId) {
    throw new Error("Lifecycle draft did not create a result configuration.");
  }
  const [pendingRequest] = await db
    .select()
    .from(catalogRequests)
    .where(eq(catalogRequests.resultConfigurationId, resultConfigurationId));
  const [pendingConfiguration] = await db
    .select()
    .from(resultConfigurations)
    .where(eq(resultConfigurations.id, resultConfigurationId));

  const sourceBytes = zipSync({
    "submission.txt": strToU8("The submitted community source is safe and complete."),
  });
  const sourceKey = `lifecycle/${draft.id}/source.zip`;
  await env.UPLOADS.put(sourceKey, sourceBytes, {
    httpMetadata: { contentType: "application/zip" },
  });
  await db.insert(artifacts).values({
    id: "lifecycle-source-artifact",
    showcaseId: draft.id,
    uploaderId: CONTRIBUTOR_ID,
    kind: "source",
    objectKey: sourceKey,
    fileName: "source.zip",
    contentType: "application/zip",
    byteSize: sourceBytes.byteLength,
    sha256: await sha256Hex(sourceBytes.slice().buffer),
    quarantineStatus: "approved",
    scanReportJson: "{}",
    createdAt: new Date("2026-08-01T00:00:01.000Z"),
    updatedAt: new Date("2026-08-01T00:00:01.000Z"),
  });

  const published = await publishShowcase(draft.id, CONTRIBUTOR_ID);
  const queued = await queuePublishedResult(published.id);
  const judged = await judgeRun(queued.run.id);
  const [afterJudgeRun] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, queued.run.id));
  const [afterJudgeShowcase] = await db
    .select()
    .from(showcases)
    .where(eq(showcases.id, draft.id));
  const [sampleCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(judgeSamples)
    .where(eq(judgeSamples.runId, queued.run.id));

  const approved = await resolveCatalogRequest({
    action: "approve",
    modelId: MODEL_ID,
    requestId: pendingRequest.id,
    reviewerUserId: CONTRIBUTOR_ID,
  });
  const [afterApprovalRequest] = await db
    .select()
    .from(catalogRequests)
    .where(eq(catalogRequests.id, pendingRequest.id));
  const [afterApprovalConfiguration] = await db
    .select()
    .from(resultConfigurations)
    .where(eq(resultConfigurations.id, resultConfigurationId));
  const [afterApprovalRun] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, queued.run.id));
  const [afterApprovalShowcase] = await db
    .select()
    .from(showcases)
    .where(eq(showcases.id, draft.id));

  return {
    approved,
    beforePublish: {
      catalogStatus: pendingConfiguration?.catalogStatus,
      requestKind: pendingRequest?.kind,
      requestStatus: pendingRequest?.status,
    },
    published: {
      judgeStatus: published.judgeStatus,
      status: published.status,
    },
    queued: {
      runStatus: queued.run.status,
      judgeQueueDeferred: queued.judgeQueueDeferred,
    },
    judged: {
      evidenceSufficient: judged.evidenceSufficient,
      judgeStatus: afterJudgeShowcase?.judgeStatus,
      rankingStatus: afterJudgeShowcase?.rankingStatus,
      rankEligible: afterJudgeRun?.rankEligible,
      runStatus: afterJudgeRun?.status,
      sampleCount: Number(sampleCount?.count ?? 0),
      scoreBps: afterJudgeRun?.overallScoreBps,
    },
    approvedState: {
      catalogStatus: afterApprovalConfiguration?.catalogStatus,
      modelVersionId: afterApprovalConfiguration?.modelVersionId,
      rankEligible: afterApprovalRun?.rankEligible,
      rankingStatus: afterApprovalShowcase?.rankingStatus,
      requestStatus: afterApprovalRequest?.status,
      runStatus: afterApprovalRun?.status,
    },
  };
}

const lifecycleWorker = {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/lifecycle") {
      return new Response("Not found", { status: 404 });
    }
    try {
      return Response.json(await runLifecycle());
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        { status: 500 },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
};

export default lifecycleWorker;
