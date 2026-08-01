import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  artifacts,
  benchmarkVersions,
  benchmarks,
  configurations,
  evaluationVersions,
  resultConfigurations,
  resultLeaderboardEntries,
  resultLeaderboardSnapshots,
  runArtifacts,
  runs,
  showcases,
  users,
} from "@/db/schema";
import { getBrowserBenchmarkDefinition } from "@/benchmarks";
import {
  hasRunnableStaticEntryPoint,
  supportsCommunityStaticEvaluation,
} from "@/lib/evaluation/community-static";
import { enqueueEvaluation, enqueueJudge } from "@/lib/pipeline/result-queue";
import {
  RunTransitionConflictError,
  transitionRun,
} from "@/lib/data/runs";
import { canonicalSha256 } from "@/lib/security/canonical";
import {
  communityJudgeDeadline,
  formatDeterministicRunId,
  initialCommunityRunStatus,
  REPAIRABLE_COMMUNITY_RUN_STATUSES,
  selectResultDispatchAction,
} from "@/lib/pipeline/result-dispatch";
import type { RunStatus } from "@/lib/security/run-policy";
import { readPublishedResultAggregate } from "@/lib/ranking/result-aggregate-snapshots";
import { claimJudgeBudget } from "@/lib/judging/budget";

const RESULT_REPAIR_MIN_AGE_MS = 2 * 60 * 1000;

export async function queuePublishedResult(showcaseId: string) {
  const existing = await getDb()
    .select({ id: runs.id, status: runs.status })
    .from(runs)
    .where(eq(runs.showcaseId, showcaseId))
    .limit(1);

  const [contract] = await getDb()
    .select({
      benchmarkVersionId: showcases.benchmarkVersionId,
      benchmarkCategory: benchmarkVersions.category,
      catalogStatus: resultConfigurations.catalogStatus,
      contributorId: showcases.ownerId,
      environmentHash: benchmarkVersions.environmentHash,
      harnessContractHash: benchmarkVersions.harnessContractJson,
      resultConfigurationId: showcases.resultConfigurationId,
      slug: showcases.slug,
      sourceVisibility: showcases.sourceVisibility,
      publishedAt: showcases.publishedAt,
    })
    .from(showcases)
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.id, showcases.benchmarkVersionId),
    )
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
      ),
    )
    .limit(1);
  if (!contract?.benchmarkVersionId) {
    throw new ResultQueueError("Published result contract is unavailable.");
  }
  const evidence = await getDb()
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.showcaseId, showcaseId),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    );
  const staticSource = evidence
    .filter(
      (artifact) =>
        artifact.kind === "source" &&
        ["application/zip", "application/x-zip-compressed"].includes(
          artifact.contentType,
        ),
    )
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    )[0];
  const supportsStaticEvaluation =
    Boolean(getBrowserBenchmarkDefinition(contract.benchmarkVersionId)) ||
    supportsCommunityStaticEvaluation(contract.benchmarkCategory);
  const staticSourceObject =
    supportsStaticEvaluation && staticSource
      ? await env.UPLOADS.get(staticSource.objectKey)
      : null;
  if (supportsStaticEvaluation && staticSource && !staticSourceObject) {
    throw new ResultQueueError("Approved source evidence is unavailable.");
  }
  const requiresEvaluation = Boolean(
    staticSourceObject &&
      hasRunnableStaticEntryPoint(
        new Uint8Array(await staticSourceObject.arrayBuffer()),
      ),
  );

  const now = new Date();
  let run = existing[0];
  if (!run) {
    const [evaluation] = await getDb()
      .select({ id: evaluationVersions.id })
      .from(evaluationVersions)
      .where(eq(evaluationVersions.status, "active"))
      .orderBy(desc(evaluationVersions.version))
      .limit(1);
    const [internalConfiguration] = await getDb()
      .select({ id: configurations.id })
      .from(configurations)
      .where(eq(configurations.id, "configuration-community-submission"))
      .limit(1);
    if (!evaluation || !internalConfiguration) {
      throw new ResultQueueError("The pinned judge catalog is unavailable.");
    }
    const runId = formatDeterministicRunId(
      await canonicalSha256({
        showcaseId,
        type: "community-result-run-v1",
      }),
    );
    [run] = await getDb()
      .insert(runs)
      .values({
        id: runId,
        publicSlug: `run-${runId.slice(0, 12)}`,
        contributorId: contract.contributorId,
        benchmarkVersionId: contract.benchmarkVersionId,
        configurationId: internalConfiguration.id,
        evaluationVersionId: evaluation.id,
        credentialMode: "community-submission",
        showcaseId,
        status: initialCommunityRunStatus(requiresEvaluation),
        attemptIndex: 1,
        passGroupId: runId,
        environmentHash: contract.environmentHash,
        harnessContractHash: contract.harnessContractHash,
        rankEligible: false,
        playableEnabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: runs.id, status: runs.status });
    if (!run) {
      [run] = await getDb()
        .select({ id: runs.id, status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
    }
  }
  if (!run) {
    throw new ResultQueueError("The result run could not be created.");
  }
  const linkedArtifacts = await getDb()
    .select({ objectKey: runArtifacts.objectKey })
    .from(runArtifacts)
    .where(eq(runArtifacts.runId, run.id));
  const linkedObjectKeys = new Set(
    linkedArtifacts.map((artifact) => artifact.objectKey),
  );
  for (const artifact of evidence) {
    if (linkedObjectKeys.has(artifact.objectKey)) continue;
    const kind =
      artifact.kind === "source"
        ? "generated-source"
        : artifact.kind === "image"
          ? "screenshot"
          : artifact.kind === "video"
            ? "video"
            : "run-log";
    await getDb()
      .insert(runArtifacts)
      .values({
        id: await canonicalSha256({
          artifactId: artifact.id,
          runId: run.id,
          type: "community-evidence-link-v1",
        }),
        runId: run.id,
        kind,
        objectKey: artifact.objectKey,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        sha256: artifact.sha256 ?? "unavailable",
        public:
          artifact.kind !== "source" ||
          contract.sourceVisibility === "public",
        createdAt: now,
      })
      .onConflictDoNothing();
    linkedObjectKeys.add(artifact.objectKey);
  }

  await getDb()
    .update(showcases)
    .set({
      judgeStatus: "queued",
      judgeDueAt: communityJudgeDeadline(contract.publishedAt, now),
      rankingStatus:
        contract.catalogStatus === "canonical"
          ? "pending"
          : "catalog_pending",
      updatedAt: now,
    })
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.judgeStatus, "not_queued"),
      ),
    );

  const judgeDispatched = await dispatchRepairableResult(
    run,
    requiresEvaluation,
    contract.contributorId,
  );
  return { judgeQueueDeferred: !judgeDispatched, run };
}

async function dispatchRepairableResult(
  run: { id: string; status: RunStatus },
  requiresEvaluation: boolean,
  contributorId: string,
) {
  const action = selectResultDispatchAction({
    requiresEvaluation,
    status: run.status,
  });
  if (action === "evaluate") {
    return dispatchInitialJudgeWork({
      contributorId,
      runId: run.id,
      send: () => enqueueEvaluation(run.id),
    });
  }
  if (action === "judge") {
    return dispatchInitialJudgeWork({
      contributorId,
      runId: run.id,
      send: () => enqueueJudge(run.id),
    });
  }
  if (
    action !== "move-to-judge" ||
    (run.status !== "queued_evaluation" && run.status !== "evaluating")
  ) {
    return true;
  }
  try {
    await transitionRun({
      id: run.id,
      from: run.status,
      to: "judging",
    });
  } catch (error) {
    if (!(error instanceof RunTransitionConflictError)) throw error;
    const [current] = await getDb()
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, run.id))
      .limit(1);
    if (current?.status !== "judging") return true;
  }
  return dispatchInitialJudgeWork({
    contributorId,
    runId: run.id,
    send: () => enqueueJudge(run.id),
  });
}

async function dispatchInitialJudgeWork(input: {
  contributorId: string;
  runId: string;
  send: () => Promise<void>;
}) {
  const reservation = await claimJudgeBudget({
    contributorId: input.contributorId,
    purpose: "initial",
    runId: input.runId,
    sampleCount: 1,
  });
  if (!reservation.allowed) return false;
  await input.send();
  return true;
}

export class ResultQueueError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "ResultQueueError";
  }
}

export async function markOverdueResults(now = new Date()) {
  const rows = await getDb()
    .select({ id: showcases.id })
    .from(showcases)
    .where(
      and(
        eq(showcases.status, "published"),
        inArray(showcases.judgeStatus, [
          "not_queued",
          "queued",
          "evaluating",
          "judging",
        ]),
        lte(showcases.judgeDueAt, now),
        sql`NOT EXISTS (
          SELECT 1
          FROM runs AS scored_run
          WHERE scored_run.showcase_id = ${showcases.id}
            AND scored_run.status IN ('scored', 'published')
        )`,
      ),
    );
  if (rows.length === 0) return [];
  const { env } = await import("cloudflare:workers");
  const statements = rows.flatMap((row) => [
    env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_user_id, entity_type, entity_id, action, metadata_json, created_at)
       SELECT ?, NULL, 'showcase', ?, 'showcase.judge_overdue', ?, ?
       FROM showcases
       WHERE id = ?
         AND status = 'published'
         AND judge_status IN ('not_queued', 'queued', 'evaluating', 'judging')
         AND judge_due_at <= ?
         AND NOT EXISTS (
           SELECT 1
           FROM runs AS scored_run
           WHERE scored_run.showcase_id = showcases.id
             AND scored_run.status IN ('scored', 'published')
         )`,
    ).bind(
      crypto.randomUUID(),
      row.id,
      JSON.stringify({ overdueAt: now.toISOString(), targetHours: 24 }),
      now.getTime(),
      row.id,
      now.getTime(),
    ),
    env.DB.prepare(
      `UPDATE showcases
       SET judge_status = 'overdue', updated_at = ?
       WHERE id = ?
         AND status = 'published'
         AND judge_status IN ('not_queued', 'queued', 'evaluating', 'judging')
         AND judge_due_at <= ?
         AND NOT EXISTS (
           SELECT 1
           FROM runs AS scored_run
           WHERE scored_run.showcase_id = showcases.id
             AND scored_run.status IN ('scored', 'published')
         )`,
    ).bind(now.getTime(), row.id, now.getTime()),
  ]);
  const results = await env.DB.batch(statements);
  return rows.flatMap((row, index) =>
    Number(results[index * 2 + 1]?.meta.changes ?? 0) === 1
      ? [row.id]
      : [],
  );
}

export async function queueMissingPublishedResults(limit = 50) {
  const repairBefore = new Date(Date.now() - RESULT_REPAIR_MIN_AGE_MS);
  const rows = await getDb()
    .select({ showcaseId: showcases.id })
    .from(showcases)
    .leftJoin(runs, eq(runs.showcaseId, showcases.id))
    .where(
      and(
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        or(
          isNull(runs.id),
          and(
            inArray(runs.status, REPAIRABLE_COMMUNITY_RUN_STATUSES),
            lte(runs.updatedAt, repairBefore),
          ),
        ),
      ),
    )
    .orderBy(showcases.publishedAt)
    .limit(limit);
  const queued: string[] = [];
  for (const row of rows) {
    await queuePublishedResult(row.showcaseId);
    queued.push(row.showcaseId);
  }
  return queued;
}

export async function listPublicResultLeaderboard() {
  const currentEvaluation = await getCurrentPublishedResultEvaluation();
  if (!currentEvaluation) return [];
  const rows = await getDb()
    .select({
      testTitle: benchmarkVersions.title,
      testSlug: benchmarks.slug,
      testVersion: benchmarkVersions.version,
      snapshotVersion: resultLeaderboardSnapshots.version,
      snapshotPublishedAt: resultLeaderboardSnapshots.publishedAt,
      evaluationVersion: evaluationVersions.version,
      evaluationVersionId: evaluationVersions.id,
      judgeSnapshot: evaluationVersions.judgeModelVersion,
      rank: resultLeaderboardEntries.rank,
      scoreBps: resultLeaderboardEntries.scoreBps,
      sampleCount: resultLeaderboardEntries.sampleCount,
      resultSlug: showcases.slug,
      resultTitle: showcases.title,
      model: resultConfigurations.modelLabel,
      modelVersion: resultConfigurations.modelVersionLabel,
      harness: resultConfigurations.harnessLabel,
      reasoning: resultConfigurations.reasoningNormalized,
      contributor: users.handle,
    })
    .from(resultLeaderboardEntries)
    .innerJoin(
      resultLeaderboardSnapshots,
      eq(
        resultLeaderboardSnapshots.id,
        resultLeaderboardEntries.snapshotId,
      ),
    )
    .innerJoin(
      benchmarkVersions,
      eq(
        benchmarkVersions.id,
        resultLeaderboardSnapshots.benchmarkVersionId,
      ),
    )
    .innerJoin(
      benchmarks,
      eq(benchmarks.id, benchmarkVersions.benchmarkId),
    )
    .innerJoin(
      evaluationVersions,
      eq(
        evaluationVersions.id,
        resultLeaderboardSnapshots.evaluationVersionId,
      ),
    )
    .innerJoin(
      showcases,
      eq(showcases.id, resultLeaderboardEntries.showcaseId),
    )
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .innerJoin(users, eq(users.id, showcases.ownerId))
    .where(
      and(
        eq(resultLeaderboardSnapshots.status, "published"),
        eq(
          resultLeaderboardSnapshots.evaluationVersionId,
          currentEvaluation.id,
        ),
      ),
    )
    .orderBy(
      benchmarkVersions.title,
      resultLeaderboardEntries.rank,
      showcases.id,
    );
  return rows;
}

export async function getCurrentPublishedResultEvaluation() {
  const [row] = await getDb()
    .select({
      id: evaluationVersions.id,
      version: evaluationVersions.version,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.status, "active"))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  return row ?? null;
}

export async function listPublicConfigurationSummaries(modelSlug?: string) {
  const currentEvaluation = await getCurrentPublishedResultEvaluation();
  return (
    (currentEvaluation
      ? await readPublishedResultAggregate(currentEvaluation.id, modelSlug)
      : null) ?? {
      evaluationVersion: null,
      snapshotDate: null,
      snapshotHash: await canonicalSha256([]),
      snapshotVersion: null,
      summaries: [],
    }
  );
}
