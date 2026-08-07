import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  benchmarks,
  evaluationVersions,
  rubricDimensions,
  users,
} from "@/db/schema";
import type { z } from "zod";
import { communityTestDraftSchema, slugify } from "@/lib/security/policy";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import {
  draftRubricWithPinnedJudge,
  RUBRIC_DRAFT_PROTOCOL_VERSION,
  requiresJudgeSource,
  type RubricDraft,
  rubricDraftSchema,
} from "@/lib/judging/rubric-draft";
import {
  COMMUNITY_TEST_DRAFT_OWNER_GUARD_SQL,
  CREATE_COMMUNITY_TEST_DRAFT_VERSION_SQL,
  isEditableCommunityTestVersion,
} from "@/lib/domain/community-test-versioning";

type CommunityTestVersionContent = z.infer<typeof communityTestDraftSchema>;

async function insertCommunityTestDraftVersion(input: {
  benchmarkId: string;
  creatorId: string;
  expectedVersion: number;
  content: CommunityTestVersionContent;
  rubric: z.infer<typeof rubricDraftSchema>["dimensions"];
}) {
  const versionId = `${input.benchmarkId}:v${input.expectedVersion}`;
  const rubricJson = canonicalJson(input.rubric);
  const now = Date.now();
  const db = getDb();
  const draftGuard = `
    EXISTS (
      SELECT 1
      FROM benchmark_versions
      JOIN benchmarks ON benchmarks.id = benchmark_versions.benchmark_id
      WHERE benchmark_versions.id = ?
        AND benchmark_versions.published_at IS NULL
        AND benchmark_versions.rubric_json = ?
        AND benchmarks.id = ?
        AND benchmarks.creator_id = ?
        AND benchmarks.status = 'active'
        AND benchmarks.rubric_status = 'approved'
    )`;
  const statements: D1PreparedStatement[] = [
    db.$client
      .prepare(CREATE_COMMUNITY_TEST_DRAFT_VERSION_SQL)
      .bind(
        versionId,
        input.content.title,
        input.content.goal,
        canonicalJson(input.content.successCriteria),
        input.content.category,
        input.content.prompt,
        rubricJson,
        now,
        now,
        input.benchmarkId,
        input.creatorId,
      ),
    ...input.rubric.map((dimension, ordinal) =>
      db.$client
        .prepare(
          `INSERT INTO rubric_dimensions
           (id, benchmark_version_id, key, title, description, mechanism,
             weight_bps, judge_source_required, ordinal, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 'judge', ?, ?, ?, ?, ?
           WHERE ${draftGuard}`,
        )
        .bind(
          `${versionId}:${dimension.key}`,
          versionId,
          dimension.key,
          dimension.title,
          dimension.description,
          dimension.weightBps,
          requiresJudgeSource(dimension) ? 1 : 0,
          ordinal + 1,
          now,
          now,
          versionId,
          rubricJson,
          input.benchmarkId,
          input.creatorId,
        ),
    ),
  ];
  const results = await db.$client.batch(statements);
  const reserved = Number(results[0]?.meta.changes ?? 0) === 1;
  const inserted = results
    .slice(1)
    .every((result) => Number(result.meta.changes ?? 0) === 1);
  const returned = results[0]?.results?.[0] as
    | { id?: unknown; version?: unknown }
    | undefined;
  if (
    !reserved ||
    !inserted ||
    returned?.id !== versionId ||
    Number(returned.version) !== input.expectedVersion
  ) {
    throw new CommunityTestConflictError();
  }
  return versionId;
}

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
  const [evaluation] = await getDb()
    .select({
      endpointOrigin: evaluationVersions.endpointOrigin,
      id: evaluationVersions.id,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      maxTokensPerSample: evaluationVersions.maxTokensPerSample,
      promptTemplateHash: evaluationVersions.promptTemplateHash,
      provider: evaluationVersions.judgeProvider,
      version: evaluationVersions.version,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.status, "active"))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  if (!evaluation) throw new CommunityTestConfigurationError();

  const draft = await draftRubricWithPinnedJudge({
    category: parsed.category,
    endpointOrigin: evaluation.endpointOrigin,
    goal: parsed.goal,
    maxTokens: evaluation.maxTokensPerSample,
    model: evaluation.judgeModelVersion,
    prompt: parsed.prompt,
    provider: evaluation.provider,
    successCriteria: parsed.successCriteria,
  });
  const rubric = rubricDraftSchema.parse(draft.rubric).dimensions;
  const now = new Date();
  const id = crypto.randomUUID();
  const versionId = `${id}:v1`;
  const slug = `${slugify(parsed.title)}-${id.slice(0, 8)}`;
  const db = getDb();
  await db.batch([
    db.insert(benchmarks).values({
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
    }),
    db.insert(benchmarkVersions).values({
      id: versionId,
      benchmarkId: id,
      version: 1,
      title: parsed.title,
      goal: parsed.goal,
      successCriteriaJson: canonicalJson(parsed.successCriteria),
      category: parsed.category,
      canonicalPrompt: parsed.prompt,
      rubricJson: canonicalJson(rubric),
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
    }),
    db.insert(rubricDimensions).values(
      rubric.map((dimension, ordinal) => ({
        id: `${versionId}:${dimension.key}`,
        benchmarkVersionId: versionId,
        key: dimension.key,
        title: dimension.title,
        description: dimension.description,
        mechanism: dimension.mechanism,
        weightBps: dimension.weightBps,
        judgeSourceRequired: requiresJudgeSource(dimension),
        ordinal: ordinal + 1,
        createdAt: now,
        updatedAt: now,
      })),
    ),
  ]);
  return {
    id,
    slug,
    versionId,
    version: 1,
    rubric,
    rubricDraft: {
      evaluationVersionId: evaluation.id,
      evaluationVersion: evaluation.version,
      judgeModelVersion: evaluation.judgeModelVersion,
      inputTokens: draft.inputTokens,
      outputTokens: draft.outputTokens,
      promptHash: draft.promptHash,
      promptTemplateHash: evaluation.promptTemplateHash,
      protocolVersion: RUBRIC_DRAFT_PROTOCOL_VERSION,
      responseHash: draft.responseHash,
    },
  };
}

export async function createCommunityTestVersion(
  id: string,
  creatorId: string,
  input: z.infer<typeof communityTestDraftSchema>,
) {
  const parsed = communityTestDraftSchema.parse(input);
  const [source] = await getDb()
    .select({
      version: benchmarkVersions.version,
    })
    .from(benchmarks)
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.benchmarkId, benchmarks.id),
    )
    .where(
      and(
        eq(benchmarks.id, id),
        eq(benchmarks.creatorId, creatorId),
        eq(benchmarks.status, "active"),
        eq(benchmarks.rubricStatus, "approved"),
        isNotNull(benchmarkVersions.publishedAt),
      ),
    )
    .orderBy(desc(benchmarkVersions.version))
    .limit(1);
  if (!source) throw new CommunityTestConflictError();

  const [evaluation] = await getDb()
    .select({
      endpointOrigin: evaluationVersions.endpointOrigin,
      id: evaluationVersions.id,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      maxTokensPerSample: evaluationVersions.maxTokensPerSample,
      promptTemplateHash: evaluationVersions.promptTemplateHash,
      provider: evaluationVersions.judgeProvider,
      version: evaluationVersions.version,
    })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.status, "active"))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  if (!evaluation) throw new CommunityTestConfigurationError();

  const drafted = await draftRubricWithPinnedJudge({
    category: parsed.category,
    endpointOrigin: evaluation.endpointOrigin,
    goal: parsed.goal,
    maxTokens: evaluation.maxTokensPerSample,
    model: evaluation.judgeModelVersion,
    prompt: parsed.prompt,
    provider: evaluation.provider,
    successCriteria: parsed.successCriteria,
  });
  const rubric = rubricDraftSchema.parse(drafted.rubric).dimensions;
  const expectedVersion = source.version + 1;
  const versionId = await insertCommunityTestDraftVersion({
    benchmarkId: id,
    creatorId,
    expectedVersion,
    content: parsed,
    rubric,
  });

  return {
    id,
    versionId,
    version: expectedVersion,
    rubric,
    rubricDraft: {
      evaluationVersionId: evaluation.id,
      evaluationVersion: evaluation.version,
      judgeModelVersion: evaluation.judgeModelVersion,
      inputTokens: drafted.inputTokens,
      outputTokens: drafted.outputTokens,
      promptHash: drafted.promptHash,
      promptTemplateHash: evaluation.promptTemplateHash,
      protocolVersion: RUBRIC_DRAFT_PROTOCOL_VERSION,
      responseHash: drafted.responseHash,
    },
  };
}

export async function getCommunityTestDraft(id: string, creatorId: string) {
  const [contract] = await getDb()
    .select({
      versionId: benchmarkVersions.id,
      publishedAt: benchmarkVersions.publishedAt,
      rubricStatus: benchmarks.rubricStatus,
      status: benchmarks.status,
      version: benchmarkVersions.version,
    })
    .from(benchmarks)
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.benchmarkId, benchmarks.id),
    )
    .where(
      and(
        eq(benchmarks.id, id),
        eq(benchmarks.creatorId, creatorId),
        isNull(benchmarkVersions.publishedAt),
      ),
    )
    .orderBy(desc(benchmarkVersions.version))
    .limit(1);
  if (!contract || !isEditableCommunityTestVersion(contract)) return null;
  const rubric = await getDb()
    .select({
      description: rubricDimensions.description,
      key: rubricDimensions.key,
      mechanism: rubricDimensions.mechanism,
      title: rubricDimensions.title,
      weightBps: rubricDimensions.weightBps,
    })
    .from(rubricDimensions)
    .where(eq(rubricDimensions.benchmarkVersionId, contract.versionId))
    .orderBy(rubricDimensions.ordinal);
  const parsed = rubricDraftSchema.safeParse({ dimensions: rubric });
  if (!parsed.success) throw new CommunityTestConflictError();
  return {
    id,
    versionId: contract.versionId,
    version: contract.version,
    rubric: parsed.data.dimensions,
  };
}

export async function approveCommunityTest(id: string, creatorId: string) {
  const [contract] = await getDb()
    .select({
      benchmarkId: benchmarks.id,
      benchmarkVersionId: benchmarkVersions.id,
      rubricJson: benchmarkVersions.rubricJson,
      rubricStatus: benchmarks.rubricStatus,
      status: benchmarks.status,
      publishedAt: benchmarkVersions.publishedAt,
      version: benchmarkVersions.version,
    })
    .from(benchmarks)
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.benchmarkId, benchmarks.id),
    )
    .where(
      and(eq(benchmarks.id, id), eq(benchmarks.creatorId, creatorId)),
    )
    .orderBy(desc(benchmarkVersions.version))
    .limit(1);
  if (
    !contract ||
    !isEditableCommunityTestVersion(contract)
  ) {
    throw new CommunityTestConflictError();
  }
  const dimensions = await getDb()
    .select({
      description: rubricDimensions.description,
      key: rubricDimensions.key,
      mechanism: rubricDimensions.mechanism,
      title: rubricDimensions.title,
      weightBps: rubricDimensions.weightBps,
    })
    .from(rubricDimensions)
    .where(eq(rubricDimensions.benchmarkVersionId, contract.benchmarkVersionId))
    .orderBy(rubricDimensions.ordinal);
  let storedRubric: ReturnType<typeof rubricDraftSchema.safeParse>;
  try {
    storedRubric = rubricDraftSchema.safeParse({
      dimensions: JSON.parse(contract.rubricJson) as unknown,
    });
  } catch {
    throw new CommunityTestConflictError();
  }
  const storedDimensions = rubricDraftSchema.safeParse({ dimensions });
  if (
    !storedRubric.success ||
    !storedDimensions.success ||
    canonicalJson(storedRubric.data.dimensions) !==
      canonicalJson(storedDimensions.data.dimensions)
  ) {
    throw new CommunityTestConflictError();
  }

  const now = new Date();
  const db = getDb();
  const publishAt = now.getTime();
  const results = await db.$client.batch([
    db.$client
      .prepare(
        `UPDATE benchmark_versions
         SET published_at = ?, updated_at = ?
         WHERE id = ?
           AND published_at IS NULL
           AND rubric_json = ?
           AND EXISTS (
             SELECT 1
             FROM benchmarks
             WHERE benchmarks.id = benchmark_versions.benchmark_id
               AND benchmarks.id = ?
               AND benchmarks.creator_id = ?
               AND (
                 (benchmark_versions.version = 1
                   AND benchmarks.status = 'draft'
                   AND benchmarks.rubric_status = 'awaiting_approval')
                 OR
                 (benchmark_versions.version > 1
                   AND benchmarks.status = 'active'
                   AND benchmarks.rubric_status = 'approved')
               )
           )`,
      )
      .bind(
        publishAt,
        publishAt,
        contract.benchmarkVersionId,
        contract.rubricJson,
        id,
        creatorId,
      ),
    db.$client
      .prepare(
        `UPDATE benchmarks
         SET status = 'active', rubric_status = 'approved', updated_at = ?
         WHERE id = ?
           AND creator_id = ?
           AND (
             (status = 'draft' AND rubric_status = 'awaiting_approval')
             OR
             (status = 'active' AND rubric_status = 'approved')
           )
           AND EXISTS (
             SELECT 1
             FROM benchmark_versions
             WHERE benchmark_versions.id = ?
               AND benchmark_versions.benchmark_id = benchmarks.id
               AND benchmark_versions.published_at = ?
               AND benchmark_versions.rubric_json = ?
               AND (
                 (benchmark_versions.version = 1
                   AND benchmarks.status = 'draft'
                   AND benchmarks.rubric_status = 'awaiting_approval')
                 OR
                 (benchmark_versions.version > 1
                   AND benchmarks.status = 'active'
                   AND benchmarks.rubric_status = 'approved')
               )
           )`,
      )
      .bind(
        publishAt,
        id,
        creatorId,
        contract.benchmarkVersionId,
        publishAt,
        contract.rubricJson,
      ),
  ]);
  if (
    Number(results[0]?.meta.changes ?? 0) !== 1 ||
    Number(results[1]?.meta.changes ?? 0) !== 1
  ) {
    throw new CommunityTestConflictError();
  }
  const [test] = await getDb()
    .select()
    .from(benchmarks)
    .where(eq(benchmarks.id, id))
    .limit(1);
  if (!test) throw new CommunityTestConflictError();
  return {
    ...test,
    versionId: contract.benchmarkVersionId,
    version: contract.version,
  };
}

export async function updateCommunityTestRubric(
  id: string,
  creatorId: string,
  input: RubricDraft,
) {
  const draft = rubricDraftSchema.parse(input);
  const [contract] = await getDb()
    .select({
      benchmarkVersionId: benchmarkVersions.id,
      category: benchmarkVersions.category,
      goal: benchmarkVersions.goal,
      prompt: benchmarkVersions.canonicalPrompt,
      publishedAt: benchmarkVersions.publishedAt,
      rubricStatus: benchmarks.rubricStatus,
      status: benchmarks.status,
      successCriteriaJson: benchmarkVersions.successCriteriaJson,
      title: benchmarkVersions.title,
      version: benchmarkVersions.version,
    })
    .from(benchmarks)
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.benchmarkId, benchmarks.id),
    )
    .where(
      and(eq(benchmarks.id, id), eq(benchmarks.creatorId, creatorId)),
    )
    .orderBy(desc(benchmarkVersions.version))
    .limit(1);
  if (!contract) throw new CommunityTestConflictError();
  if (contract.publishedAt !== null) {
    if (
      contract.status !== "active" ||
      contract.rubricStatus !== "approved"
    ) {
      throw new CommunityTestConflictError();
    }
    let successCriteria: unknown;
    try {
      successCriteria = JSON.parse(contract.successCriteriaJson);
    } catch {
      throw new CommunityTestConflictError();
    }
    const content = communityTestDraftSchema.parse({
      category: contract.category,
      goal: contract.goal,
      prompt: contract.prompt,
      successCriteria,
      title: contract.title,
    });
    const version = contract.version + 1;
    const versionId = await insertCommunityTestDraftVersion({
      benchmarkId: id,
      creatorId,
      expectedVersion: version,
      content,
      rubric: draft.dimensions,
    });
    return { id, versionId, version, rubric: draft.dimensions };
  }
  if (!isEditableCommunityTestVersion(contract)) {
    throw new CommunityTestConflictError();
  }

  const now = Date.now();
  const rubricJson = canonicalJson(draft.dimensions);
  const db = getDb();
  const dimensionGuard = `
    EXISTS (
      SELECT 1
      FROM benchmark_versions
      JOIN benchmarks ON benchmarks.id = benchmark_versions.benchmark_id
      WHERE benchmark_versions.id = ?
        AND benchmark_versions.published_at IS NULL
        AND benchmark_versions.rubric_json = ?
        AND benchmarks.id = ?
        AND benchmarks.creator_id = ?
        AND (
          (benchmark_versions.version = 1
            AND benchmarks.status = 'draft'
            AND benchmarks.rubric_status = 'awaiting_approval')
          OR
          (benchmark_versions.version > 1
            AND benchmarks.status = 'active'
            AND benchmarks.rubric_status = 'approved')
        )
    )`;
  const statements: D1PreparedStatement[] = [
    db.$client
      .prepare(
        `UPDATE benchmark_versions
         SET rubric_json = ?, updated_at = ?
           WHERE id = ?
           AND published_at IS NULL
           AND ${COMMUNITY_TEST_DRAFT_OWNER_GUARD_SQL}`,
      )
      .bind(
        rubricJson,
        now,
        contract.benchmarkVersionId,
        id,
        creatorId,
      ),
    db.$client
      .prepare(
        `DELETE FROM rubric_dimensions
         WHERE benchmark_version_id = ?
           AND ${dimensionGuard}`,
      )
      .bind(
        contract.benchmarkVersionId,
        contract.benchmarkVersionId,
        rubricJson,
        id,
        creatorId,
      ),
    ...draft.dimensions.map((dimension, ordinal) =>
      db.$client
        .prepare(
          `INSERT INTO rubric_dimensions
           (id, benchmark_version_id, key, title, description, mechanism,
             weight_bps, judge_source_required, ordinal, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, 'judge', ?, ?, ?, ?, ?
           WHERE ${dimensionGuard}`,
        )
        .bind(
          `${contract.benchmarkVersionId}:${dimension.key}`,
          contract.benchmarkVersionId,
          dimension.key,
          dimension.title,
          dimension.description,
          dimension.weightBps,
          requiresJudgeSource(dimension) ? 1 : 0,
          ordinal + 1,
          now,
          now,
          contract.benchmarkVersionId,
          rubricJson,
          id,
          creatorId,
        ),
    ),
    db.$client
      .prepare(
        `UPDATE benchmarks
         SET updated_at = ?
         WHERE id = ?
           AND creator_id = ?
           AND (
             (status = 'draft' AND rubric_status = 'awaiting_approval')
             OR
             (status = 'active' AND rubric_status = 'approved')
           )
           AND EXISTS (
             SELECT 1
             FROM benchmark_versions
             WHERE benchmark_versions.id = ?
               AND benchmark_versions.benchmark_id = benchmarks.id
               AND benchmark_versions.published_at IS NULL
               AND benchmark_versions.rubric_json = ?
               AND (
                 (benchmark_versions.version = 1
                   AND benchmarks.status = 'draft'
                   AND benchmarks.rubric_status = 'awaiting_approval')
                 OR
                 (benchmark_versions.version > 1
                   AND benchmarks.status = 'active'
                   AND benchmarks.rubric_status = 'approved')
               )
           )`,
      )
      .bind(
        now,
        id,
        creatorId,
        contract.benchmarkVersionId,
        rubricJson,
      ),
  ];
  const results = await db.$client.batch(statements);
  const versionChanged = Number(results[0]?.meta.changes ?? 0) === 1;
  const dimensionsDeleted = Number(results[1]?.meta.changes ?? 0) >= 3;
  const dimensionResults = results.slice(2, 2 + draft.dimensions.length);
  const dimensionsInserted = dimensionResults.every(
    (result) => Number(result.meta.changes ?? 0) === 1,
  );
  const benchmarkChanged =
    Number(results.at(-1)?.meta.changes ?? 0) === 1;
  if (
    !versionChanged ||
    !dimensionsDeleted ||
    !dimensionsInserted ||
    !benchmarkChanged
  ) {
    throw new CommunityTestConflictError();
  }
  return {
    id,
    versionId: contract.benchmarkVersionId,
    version: contract.version,
    rubric: draft.dimensions,
  };
}

export async function listCommunityTests() {
  return getDb()
    .select({
      id: benchmarks.id,
      slug: benchmarks.slug,
      title: benchmarkVersions.title,
      goal: benchmarkVersions.goal,
      category: benchmarkVersions.category,
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
        isNotNull(benchmarkVersions.publishedAt),
      ),
    )
    .orderBy(desc(benchmarkVersions.publishedAt), benchmarkVersions.title);
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
    super("This test or rubric cannot be changed in its current state.");
    this.name = "CommunityTestConflictError";
  }
}
