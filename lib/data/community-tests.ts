import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  benchmarks,
  rubricDimensions,
  users,
} from "@/db/schema";
import type { z } from "zod";
import { communityTestDraftSchema, slugify } from "@/lib/security/policy";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";

const STARTER_RUBRIC = [
  {
    key: "task-success",
    title: "Task success",
    description: "How fully the submitted evidence achieves the requested outcome.",
    mechanism: "judge" as const,
    weightBps: 6000,
    judgeSourceRequired: false,
  },
  {
    key: "correctness",
    title: "Correctness",
    description: "How correct, reliable, and internally consistent the result is.",
    mechanism: "judge" as const,
    weightBps: 4000,
    judgeSourceRequired: false,
  },
] as const;

export async function createCommunityTest(
  creatorId: string,
  input: z.infer<typeof communityTestDraftSchema>,
) {
  const parsed = communityTestDraftSchema.parse(input);
  const [template] = await getDb()
    .select({
      dependencyLockHash: benchmarkVersions.dependencyLockHash,
      environmentHash: benchmarkVersions.environmentHash,
      harnessContractJson: benchmarkVersions.harnessContractJson,
      harnessId: benchmarkVersions.harnessId,
    })
    .from(benchmarkVersions)
    .where(isNotNull(benchmarkVersions.publishedAt))
    .orderBy(desc(benchmarkVersions.publishedAt))
    .limit(1);
  if (!template) throw new CommunityTestConfigurationError();
  const now = new Date();
  const id = crypto.randomUUID();
  const versionId = `${id}:v1`;
  const slug = `${slugify(parsed.title)}-${id.slice(0, 8)}`;
  await getDb().insert(benchmarks).values({
    id,
    creatorId,
    slug,
    title: parsed.title,
    goal: parsed.goal,
    successCriteriaJson: canonicalJson(parsed.successCriteria),
    category: parsed.category,
    status: "draft",
    rubricStatus: "awaiting_approval",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(benchmarkVersions).values({
    id: versionId,
    benchmarkId: id,
    version: 1,
    canonicalPrompt: parsed.prompt,
    rubricJson: canonicalJson(STARTER_RUBRIC),
    harnessId: template.harnessId,
    harnessContractJson: template.harnessContractJson,
    environmentHash: template.environmentHash,
    objectiveWeightBps: 0,
    judgeWeightBps: 10_000,
    attemptPolicy: "pass@1",
    attemptCount: 1,
    dependencyLockHash: template.dependencyLockHash,
    interactionScriptHash: await canonicalSha256({
      mode: "submitted-evidence-only",
    }),
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const [ordinal, dimension] of STARTER_RUBRIC.entries()) {
    await getDb().insert(rubricDimensions).values({
      id: `${versionId}:${dimension.key}`,
      benchmarkVersionId: versionId,
      key: dimension.key,
      title: dimension.title,
      description: dimension.description,
      mechanism: dimension.mechanism,
      weightBps: dimension.weightBps,
      judgeSourceRequired: dimension.judgeSourceRequired,
      ordinal: ordinal + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { id, slug, versionId, rubric: STARTER_RUBRIC };
}

export async function approveCommunityTest(id: string, creatorId: string) {
  const now = new Date();
  const [test] = await getDb()
    .update(benchmarks)
    .set({
      status: "active",
      rubricStatus: "approved",
      updatedAt: now,
    })
    .where(
      and(
        eq(benchmarks.id, id),
        eq(benchmarks.creatorId, creatorId),
        eq(benchmarks.status, "draft"),
        eq(benchmarks.rubricStatus, "awaiting_approval"),
      ),
    )
    .returning();
  if (!test) throw new CommunityTestConflictError();
  await getDb()
    .update(benchmarkVersions)
    .set({ publishedAt: now, updatedAt: now })
    .where(
      and(
        eq(benchmarkVersions.benchmarkId, id),
        eq(benchmarkVersions.version, 1),
      ),
    );
  return test;
}

export async function listCommunityTests() {
  return getDb()
    .select({
      id: benchmarks.id,
      slug: benchmarks.slug,
      title: benchmarks.title,
      goal: benchmarks.goal,
      category: benchmarks.category,
      creator: users.handle,
      versionId: benchmarkVersions.id,
      version: benchmarkVersions.version,
      prompt: benchmarkVersions.canonicalPrompt,
      publishedAt: benchmarkVersions.publishedAt,
    })
    .from(benchmarks)
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.benchmarkId, benchmarks.id),
    )
    .leftJoin(users, eq(users.id, benchmarks.creatorId))
    .where(
      and(
        eq(benchmarks.status, "active"),
        eq(benchmarks.rubricStatus, "approved"),
      ),
    )
    .orderBy(desc(benchmarkVersions.publishedAt), benchmarks.title);
}

export class CommunityTestConfigurationError extends Error {
  readonly status = 503;
  constructor() {
    super("A published evaluator template is required before creating tests.");
    this.name = "CommunityTestConfigurationError";
  }
}

export class CommunityTestConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("This test cannot be approved in its current state.");
    this.name = "CommunityTestConflictError";
  }
}
