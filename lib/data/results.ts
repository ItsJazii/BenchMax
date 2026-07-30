import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artifacts,
  benchmarkVersions,
  configurations,
  evaluationVersions,
  resultConfigurations,
  runArtifacts,
  runs,
  showcases,
} from "@/db/schema";
import { getBrowserBenchmarkDefinition } from "@/benchmarks";
import { enqueueEvaluation, enqueueJudge } from "@/lib/pipeline/result-queue";
import { transitionRun } from "@/lib/data/runs";

const JUDGE_DEADLINE_MS = 24 * 60 * 60 * 1000;

export async function queuePublishedResult(showcaseId: string) {
  const existing = await getDb()
    .select({ id: runs.id, status: runs.status })
    .from(runs)
    .where(eq(runs.showcaseId, showcaseId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [contract] = await getDb()
    .select({
      benchmarkVersionId: showcases.benchmarkVersionId,
      catalogStatus: resultConfigurations.catalogStatus,
      contributorId: showcases.ownerId,
      environmentHash: benchmarkVersions.environmentHash,
      harnessContractHash: benchmarkVersions.harnessContractJson,
      resultConfigurationId: showcases.resultConfigurationId,
      slug: showcases.slug,
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

  const now = new Date();
  const runId = crypto.randomUUID();
  const [run] = await getDb()
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
      status: "queued_evaluation",
      attemptIndex: 1,
      passGroupId: runId,
      environmentHash: contract.environmentHash,
      harnessContractHash: contract.harnessContractHash,
      rankEligible: false,
      playableEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const evidence = await getDb()
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.showcaseId, showcaseId),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    );
  for (const artifact of evidence) {
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
        id: crypto.randomUUID(),
        runId,
        kind,
        objectKey: artifact.objectKey,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        sha256: artifact.sha256 ?? "unavailable",
        public:
          artifact.kind !== "source" ||
          (await sourceIsPublic(showcaseId)),
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  await getDb()
    .update(showcases)
    .set({
      judgeStatus: "queued",
      judgeDueAt: new Date(now.getTime() + JUDGE_DEADLINE_MS),
      rankingStatus:
        contract.catalogStatus === "canonical"
          ? "pending"
          : "catalog_pending",
      updatedAt: now,
    })
    .where(eq(showcases.id, showcaseId));

  const executableSource = evidence.some(
    (artifact) =>
      artifact.kind === "source" &&
      ["application/zip", "application/x-zip-compressed"].includes(
        artifact.contentType,
      ),
  );
  if (
    executableSource &&
    getBrowserBenchmarkDefinition(contract.benchmarkVersionId)
  ) {
    await enqueueEvaluation(runId);
  } else {
    await transitionRun({
      id: runId,
      from: "queued_evaluation",
      to: "evaluating",
    });
    await enqueueJudge(runId);
  }
  return run;
}

async function sourceIsPublic(showcaseId: string) {
  const [row] = await getDb()
    .select({ visibility: showcases.sourceVisibility })
    .from(showcases)
    .where(eq(showcases.id, showcaseId))
    .limit(1);
  return row?.visibility === "public";
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
    .update(showcases)
    .set({ judgeStatus: "overdue", updatedAt: now })
    .where(
      and(
        eq(showcases.status, "published"),
        inArray(showcases.judgeStatus, ["queued", "evaluating", "judging"]),
        lte(showcases.judgeDueAt, now),
      ),
    )
    .returning({ id: showcases.id });
  return rows.map((row) => row.id);
}
