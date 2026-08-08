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
  resultLeaderboardSnapshots,
  resultLeaderboardEntries,
  disputes,
  auditEvents,
} from "../../db/schema";
import { createShowcaseDraft } from "../../lib/data/showcases";
import { publishShowcase } from "../../lib/data/showcases";
import { queuePublishedResult } from "../../lib/data/results";
import { judgeRun, JudgeContractError } from "../../lib/judging/judge-run";
import { resolveCatalogRequest } from "../../lib/data/catalog-requests";
import { seedRankedCatalog } from "../../lib/data/catalog-admin";
import { listModerationQueue } from "../../lib/data/community";
import { runJudgeCalibration } from "../../lib/judging/calibration";
import { JUDGE_PROTOCOL_TEMPLATE_V1 } from "../../lib/domain/ranked-catalog";
import { repairBudgetPendingEscalations } from "../../lib/ranking/result-snapshots";
import { repairDeferredDisputeRejudgments } from "../../lib/data/dispute-rejudge";
import { canonicalJson, canonicalSha256 } from "../../lib/security/canonical";
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

const calibrationJudgeOutput = JSON.stringify({
  evidence_sufficient: true,
  evidence_sufficiency_reason:
    "The calibration evidence directly supports the expected scores.",
  dimensions: [
    {
      key: "cal-a",
      score_bps: 9_000,
      reasoning: "Matches the calibration expectation for cal-a.",
    },
    {
      key: "cal-b",
      score_bps: 8_000,
      reasoning: "Matches the calibration expectation for cal-b.",
    },
  ],
});

function installJudgeStub() {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "judge.example.test") {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        messages?: unknown[];
      };
      if (!request.messages?.length) {
        return new Response("unexpected judge request", { status: 400 });
      }
      if (request.model === "kimi-k3") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: calibrationJudgeOutput } }],
            usage: { prompt_tokens: 12, completion_tokens: 24 },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (request.model !== "judge-snapshot-2026-08-07") {
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
      judgeProvider: "openai",
      judgeModel: "lifecycle-judge",
      judgeModelVersion: "judge-snapshot-2026-08-07",
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

async function seedSweepFixtures() {
  const db = getDb();
  const now = new Date("2026-08-01T01:00:00.000Z");
  await db.insert(resultConfigurations).values({
    id: "sweep-result-config",
    modelVersionId: JUDGE_MODEL_VERSION_ID,
    harnessId: HARNESS_ID,
    modelLabel: "Sweep Model",
    modelVersionLabel: "sweep-v1",
    harnessLabel: "Lifecycle Harness v1",
    reasoningRaw: "medium",
    reasoningNormalized: "medium",
    declaredSettingsJson: "{}",
    metadataHash: "sweep-result-config-hash",
    catalogStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(evaluationVersions).values({
    id: "sweep-frozen-eval",
    version: 2,
    judgeProvider: "openai",
    judgeModel: "lifecycle-judge",
    judgeModelVersion: "judge-snapshot-2026-08-07",
    endpointOrigin: "https://judge.example.test",
    promptTemplate: "Judge the frozen evidence.",
    promptTemplateHash: "sweep-frozen-prompt-hash",
    rubricProtocolVersion: "community-rubric-v1",
    sampleCount: 3,
    maxTokensPerSample: 200,
    calibrationSetHash: "lifecycle-calibration",
    driftThresholdBps: 100,
    status: "frozen",
    createdAt: now,
    updatedAt: now,
  });
  const showcaseBase = {
    ownerId: CONTRIBUTOR_ID,
    summary: "A sweep repair fixture result used to prove terminal filtering.",
    category: "frontend" as const,
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    resultConfigurationId: "sweep-result-config",
    modelLabel: "Sweep Model",
    harness: "Lifecycle Harness v1",
    reasoningLevel: "medium",
    prompt: "Build the exact lifecycle fixture.",
    sourceVisibility: "public" as const,
    rightsAttestedAt: now,
    status: "published" as const,
    safetyStatus: "approved" as const,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(showcases).values([
      {
        ...showcaseBase,
        id: "sweep-failed-showcase",
        slug: "sweep-failed-showcase",
        title: "Sweep terminal failure",
        judgeStatus: "failed",
        rankingStatus: "ineligible",
      },
      {
        ...showcaseBase,
        id: "sweep-live-showcase",
        slug: "sweep-live-showcase",
        title: "Sweep live escalation",
        judgeStatus: "overdue",
        rankingStatus: "eligible",
      },
      {
        ...showcaseBase,
        id: "sweep-dispute-showcase",
        slug: "sweep-dispute-showcase",
        title: "Sweep frozen dispute",
        judgeStatus: "judging",
        rankingStatus: "eligible",
      },
      {
        // A frozen-evaluation top-ten candidate whose showcase is still
        // "scored" (termination fires before the sweep ever set "judging") —
        // it must reach a terminal judgeStatus on the first pass instead of
        // being re-selected forever.
        ...showcaseBase,
        id: "sweep-frozen-topten-showcase",
        slug: "sweep-frozen-topten-showcase",
        title: "Sweep frozen top ten",
        judgeStatus: "scored",
        rankingStatus: "eligible",
      },
    ]),
  ]);
  const runBase = {
    contributorId: CONTRIBUTOR_ID,
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    configurationId: CONFIGURATION_ID,
    credentialMode: "community-submission" as const,
    status: "scored" as const,
    attemptIndex: 1,
    environmentHash: "lifecycle-environment",
    harnessContractHash: "lifecycle-harness-contract",
    rankEligible: false,
    injectionFlag: false,
    postPublicationMarker: false,
    playableEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(runs).values([
      {
        ...runBase,
        id: "sweep-failed-run",
        publicSlug: "sweep-failed-run",
        evaluationVersionId: EVALUATION_ID,
        showcaseId: "sweep-failed-showcase",
      },
      {
        ...runBase,
        id: "sweep-live-run",
        publicSlug: "sweep-live-run",
        evaluationVersionId: EVALUATION_ID,
        showcaseId: "sweep-live-showcase",
      },
      {
        ...runBase,
        id: "sweep-dispute-run",
        publicSlug: "sweep-dispute-run",
        evaluationVersionId: "sweep-frozen-eval",
        showcaseId: "sweep-dispute-showcase",
      },
      {
        ...runBase,
        id: "sweep-frozen-topten-run",
        publicSlug: "sweep-frozen-topten-run",
        evaluationVersionId: "sweep-frozen-eval",
        showcaseId: "sweep-frozen-topten-showcase",
      },
    ]),
    db.insert(resultLeaderboardSnapshots).values([
      {
        id: "sweep-snapshot",
        benchmarkVersionId: BENCHMARK_VERSION_ID,
        evaluationVersionId: EVALUATION_ID,
        version: 900,
        resultSetHash: "sweep-result-set",
        status: "building",
        createdAt: now,
      },
      {
        id: "sweep-frozen-snapshot",
        benchmarkVersionId: BENCHMARK_VERSION_ID,
        evaluationVersionId: "sweep-frozen-eval",
        version: 901,
        resultSetHash: "sweep-frozen-result-set",
        status: "building",
        createdAt: now,
      },
    ]),
    db.insert(resultLeaderboardEntries).values([
      {
        id: "sweep-failed-entry",
        snapshotId: "sweep-snapshot",
        showcaseId: "sweep-failed-showcase",
        runId: "sweep-failed-run",
        rank: 1,
        scoreBps: 9_000,
        sampleCount: 1,
        createdAt: now,
      },
      {
        id: "sweep-live-entry",
        snapshotId: "sweep-snapshot",
        showcaseId: "sweep-live-showcase",
        runId: "sweep-live-run",
        rank: 2,
        scoreBps: 8_000,
        sampleCount: 1,
        createdAt: now,
      },
      {
        id: "sweep-frozen-topten-entry",
        snapshotId: "sweep-frozen-snapshot",
        showcaseId: "sweep-frozen-topten-showcase",
        runId: "sweep-frozen-topten-run",
        rank: 1,
        scoreBps: 9_500,
        sampleCount: 1,
        createdAt: now,
      },
    ]),
    db.insert(disputes).values({
      id: "sweep-dispute",
      runId: "sweep-dispute-run",
      openedByUserId: CONTRIBUTOR_ID,
      reason: "The frozen-evaluation dispute must terminate, not loop.",
      status: "open",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}

async function runSweeps() {
  const db = getDb();
  await seedSweepFixtures();

  const firstTopTen = await repairBudgetPendingEscalations();
  const secondTopTen = await repairBudgetPendingEscalations();
  const [failedShowcase] = await db
    .select({ judgeStatus: showcases.judgeStatus })
    .from(showcases)
    .where(eq(showcases.id, "sweep-failed-showcase"));

  const [frozenTopTenShowcase] = await db
    .select({ judgeStatus: showcases.judgeStatus })
    .from(showcases)
    .where(eq(showcases.id, "sweep-frozen-topten-showcase"));
  const [frozenTopTenRun] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, "sweep-frozen-topten-run"));

  const firstDispute = await repairDeferredDisputeRejudgments();
  const secondDispute = await repairDeferredDisputeRejudgments();
  const [disputeShowcase] = await db
    .select({ judgeStatus: showcases.judgeStatus })
    .from(showcases)
    .where(eq(showcases.id, "sweep-dispute-showcase"));
  const [disputeRun] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, "sweep-dispute-run"));

  return {
    disputeRunStatus: disputeRun?.status,
    disputeShowcaseJudgeStatus: disputeShowcase?.judgeStatus,
    failedShowcaseJudgeStatus: failedShowcase?.judgeStatus,
    firstDispute,
    firstTopTen,
    frozenTopTenRunStatus: frozenTopTenRun?.status,
    frozenTopTenShowcaseJudgeStatus: frozenTopTenShowcase?.judgeStatus,
    secondDispute,
    secondTopTen,
  };
}

async function insertAliasEvaluationVersion(input: {
  calibrationSetHash: string;
  id: string;
  judgeModelVersion?: string;
  judgeProvider?: string;
  status: "draft" | "active";
  version: number;
}) {
  const now = new Date("2026-08-07T02:00:00.000Z");
  await getDb().insert(evaluationVersions).values({
    id: input.id,
    version: input.version,
    judgeProvider: input.judgeProvider ?? "moonshot",
    judgeModel: "kimi",
    judgeModelVersion: input.judgeModelVersion ?? "kimi-k3",
    endpointOrigin: "https://judge.example.test",
    promptTemplate: JUDGE_PROTOCOL_TEMPLATE_V1,
    promptTemplateHash: await canonicalSha256(JUDGE_PROTOCOL_TEMPLATE_V1),
    rubricProtocolVersion: "benchmax-community-rubric-v1",
    sampleCount: 3,
    maxTokensPerSample: 4096,
    calibrationSetHash: input.calibrationSetHash,
    driftThresholdBps: 750,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  });
}

async function runJudgePolicy() {
  installJudgeStub();
  const db = getDb();

  const calibrationSet = {
    version: 1,
    items: [
      {
        id: "calibration-item-1",
        benchmark:
          "Build a responsive dashboard fixture used only for calibration.",
        rubric: [
          {
            key: "cal-a",
            description: "Calibration dimension A expectation.",
            expectedScoreBps: 9_000,
          },
          {
            key: "cal-b",
            description: "Calibration dimension B expectation.",
            expectedScoreBps: 8_000,
          },
        ],
        evidence: "Calibration evidence body for the fixture item.",
      },
    ],
  };
  const setBytes = new TextEncoder().encode(JSON.stringify(calibrationSet));
  const setHash = await sha256Hex(setBytes.slice().buffer);
  await env.UPLOADS.put("calibration/policy-set.json", setBytes, {
    httpMetadata: { contentType: "application/json" },
  });
  process.env.JUDGE_PROVIDER = "moonshot";
  process.env.JUDGE_MODEL = "kimi";
  process.env.JUDGE_MODEL_VERSION = "kimi-k3";
  process.env.JUDGE_API_ORIGIN = "https://judge.example.test";
  process.env.JUDGE_CALIBRATION_SET_OBJECT_KEY = "calibration/policy-set.json";
  process.env.JUDGE_CALIBRATION_SET_HASH = setHash;
  process.env.E2B_TEMPLATE_ID = "policy-template";
  process.env.E2B_TEMPLATE_BUILD_HASH = "a".repeat(64);

  const maxVersionBefore = await latestEvaluationVersionNumber();
  await seedRankedCatalog();
  const seededDraft = await evaluationByVersion(maxVersionBefore + 1);
  await seedRankedCatalog();
  const versionAfterReseed = await latestEvaluationVersionNumber();

  const candidateCalibration = await runJudgeCalibration();
  const heldCandidate = await evaluationByVersion(maxVersionBefore + 1);

  // The candidate sink must be excluded from the next selection: the sweep
  // falls through to the older ACTIVE lifecycle version, whose stored
  // calibration hash no longer matches the uploaded set, so it freezes —
  // proving the candidate was not re-selected (no repeated candidate spend).
  const postCandidateCalibration = await runJudgeCalibration();
  const candidateAfterSecondSweep = await evaluationByVersion(
    maxVersionBefore + 1,
  );

  // Force the post-hold audit write to fail after this draft has already
  // entered the terminal candidate sink. The calibration catch path must not
  // loosen that state transition, but it must still leave an honest operator
  // audit and critical alert instead of silently returning.
  await insertAliasEvaluationVersion({
    calibrationSetHash: setHash,
    id: "policy-candidate-error",
    status: "draft",
    version: 49,
  });
  await env.DB.prepare(
    `CREATE TRIGGER policy_fail_candidate_pass_audit
     BEFORE INSERT ON audit_events
     WHEN NEW.action = 'judge.calibration_candidate_passed'
     BEGIN
       SELECT RAISE(ABORT, 'forced candidate audit failure');
     END`,
  ).run();
  const candidateErrorAlerts: string[] = [];
  const originalConsoleError = console.error;
  let candidateErrorCalibration: Awaited<
    ReturnType<typeof runJudgeCalibration>
  >;
  try {
    console.error = (...values: unknown[]) => {
      candidateErrorAlerts.push(values.map(String).join(" "));
    };
    candidateErrorCalibration = await runJudgeCalibration();
  } finally {
    console.error = originalConsoleError;
    await env.DB.prepare("DROP TRIGGER policy_fail_candidate_pass_audit").run();
  }
  const [candidateErrorEvaluation] = await db
    .select({ status: evaluationVersions.status })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.id, "policy-candidate-error"));
  const [candidateErrorAudit] = await db
    .select({
      action: auditEvents.action,
      metadataJson: auditEvents.metadataJson,
    })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, "policy-candidate-error"))
    .orderBy(sql`${auditEvents.createdAt} DESC`)
    .limit(1);

  await insertAliasEvaluationVersion({
    calibrationSetHash: setHash,
    id: "policy-active-alias",
    status: "active",
    version: 50,
  });
  const aliasCalibration = await runJudgeCalibration();
  const [frozenAlias] = await db
    .select({ status: evaluationVersions.status })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.id, "policy-active-alias"));

  // At this point the newest frozen version (the alias, v50) has no newer
  // active successor, so it must be the single calibration alert: newer
  // candidates must not suppress it, and older frozen versions (the
  // lifecycle v1 freeze, the sweep fixture's v2) must not bury it.
  const moderationAlerts = (await listModerationQueue()).calibrationAlerts.map(
    (alert: { id: string }) => alert.id,
  );

  // Frozen-latest recovery: re-seeding the identical config must mint a new
  // draft instead of silently deduping against the frozen row.
  await seedRankedCatalog();
  const recoveryDraft = await evaluationByVersion(51);

  await insertAliasEvaluationVersion({
    calibrationSetHash: setHash,
    id: "policy-terminal-alias",
    status: "active",
    version: 60,
  });
  await db.insert(resultConfigurations).values({
    id: "policy-result-config",
    modelVersionId: JUDGE_MODEL_VERSION_ID,
    harnessId: HARNESS_ID,
    modelLabel: "Policy Model",
    modelVersionLabel: "policy-v1",
    harnessLabel: "Lifecycle Harness v1",
    reasoningRaw: "medium",
    reasoningNormalized: "medium",
    declaredSettingsJson: "{}",
    metadataHash: "policy-result-config-hash",
    catalogStatus: "pending",
    createdAt: new Date("2026-08-07T02:00:01.000Z"),
    updatedAt: new Date("2026-08-07T02:00:01.000Z"),
  });
  const policyNow = new Date("2026-08-07T02:00:02.000Z");
  await db.insert(showcases).values({
    id: "policy-showcase",
    slug: "policy-showcase",
    ownerId: CONTRIBUTOR_ID,
    title: "Policy terminal fixture",
    summary: "A fixture result proving alias judging fails terminally.",
    category: "frontend",
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    resultConfigurationId: "policy-result-config",
    modelLabel: "Policy Model",
    harness: "Lifecycle Harness v1",
    reasoningLevel: "medium",
    prompt: "Build the exact lifecycle fixture.",
    sourceVisibility: "public",
    rightsAttestedAt: policyNow,
    status: "published",
    safetyStatus: "approved",
    judgeStatus: "judging",
    rankingStatus: "pending",
    publishedAt: policyNow,
    createdAt: policyNow,
    updatedAt: policyNow,
  });
  await db.insert(runs).values({
    id: "policy-run",
    publicSlug: "policy-run",
    contributorId: CONTRIBUTOR_ID,
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    configurationId: CONFIGURATION_ID,
    evaluationVersionId: "policy-terminal-alias",
    showcaseId: "policy-showcase",
    credentialMode: "community-submission",
    status: "judging",
    attemptIndex: 1,
    environmentHash: "lifecycle-environment",
    harnessContractHash: "lifecycle-harness-contract",
    rankEligible: false,
    injectionFlag: false,
    postPublicationMarker: false,
    playableEnabled: false,
    createdAt: policyNow,
    updatedAt: policyNow,
  });
  let terminalErrorCode: string | null = null;
  try {
    await judgeRun("policy-run");
  } catch (error) {
    terminalErrorCode =
      error instanceof JudgeContractError ? error.code : String(error);
  }
  const [immutabilityAudit] = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.action, "judge.model_not_immutable"));

  await insertAliasEvaluationVersion({
    calibrationSetHash: setHash,
    id: "policy-unsupported-provider",
    judgeModelVersion: "judge-snapshot-2026-08-07",
    judgeProvider: "unsupported",
    status: "active",
    version: 61,
  });
  await db.insert(runs).values({
    id: "policy-provider-run",
    publicSlug: "policy-provider-run",
    contributorId: CONTRIBUTOR_ID,
    benchmarkVersionId: BENCHMARK_VERSION_ID,
    configurationId: CONFIGURATION_ID,
    evaluationVersionId: "policy-unsupported-provider",
    showcaseId: null,
    credentialMode: "community-submission",
    status: "judging",
    attemptIndex: 1,
    environmentHash: "lifecycle-environment",
    harnessContractHash: "lifecycle-harness-contract",
    rankEligible: false,
    injectionFlag: false,
    postPublicationMarker: false,
    playableEnabled: false,
    createdAt: policyNow,
    updatedAt: policyNow,
  });
  let providerErrorCode: string | null = null;
  let providerErrorTerminal = false;
  try {
    await judgeRun("policy-provider-run");
  } catch (error) {
    providerErrorCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : String(error);
    providerErrorTerminal = error instanceof JudgeContractError;
  }
  const [providerAudit] = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.action, "judge.provider_not_supported"));

  return {
    aliasCalibration,
    candidateAfterSecondSweep: candidateAfterSecondSweep?.status,
    candidateCalibration,
    candidateErrorAuditAction: candidateErrorAudit?.action ?? null,
    candidateErrorAuditMetadata: candidateErrorAudit
      ? JSON.parse(candidateErrorAudit.metadataJson)
      : null,
    candidateErrorCalibration,
    candidateErrorCriticalAlertRecorded: candidateErrorAlerts.some((value) =>
      value.includes('"alert":"judge_calibration_failed_unfrozen"'),
    ),
    candidateErrorStatus: candidateErrorEvaluation?.status,
    frozenAliasStatus: frozenAlias?.status,
    heldCandidateStatus: heldCandidate?.status,
    immutabilityAuditRecorded: immutabilityAudit?.action ?? null,
    moderationAlerts,
    postCandidateCalibration,
    providerAuditRecorded: providerAudit?.action ?? null,
    providerErrorCode,
    providerErrorTerminal,
    recoveryDraftStatus: recoveryDraft?.status,
    seededDraftStatus: seededDraft?.status,
    seededDraftModelVersion: seededDraft?.judgeModelVersion,
    terminalErrorCode,
    versionAfterFirstSeed: maxVersionBefore + 1,
    versionAfterReseed,
  };
}

async function latestEvaluationVersionNumber() {
  const [row] = await getDb()
    .select({ version: evaluationVersions.version })
    .from(evaluationVersions)
    .orderBy(sql`${evaluationVersions.version} DESC`)
    .limit(1);
  return row?.version ?? 0;
}

async function evaluationByVersion(version: number) {
  const [row] = await getDb()
    .select({
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      status: evaluationVersions.status,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.version, version));
  return row;
}

const lifecycleWorker = {
  async fetch(request: Request) {
    const pathname = new URL(request.url).pathname;
    if (
      pathname !== "/lifecycle" &&
      pathname !== "/sweeps" &&
      pathname !== "/judge-policy"
    ) {
      return new Response("Not found", { status: 404 });
    }
    try {
      if (pathname === "/sweeps") {
        return Response.json(await runSweeps());
      }
      if (pathname === "/judge-policy") {
        return Response.json(await runJudgePolicy());
      }
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
