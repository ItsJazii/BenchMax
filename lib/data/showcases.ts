import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  artifacts,
  benchmarkVersions,
  benchmarks,
  catalogRequests,
  dimensionScores,
  evaluationVersions,
  harnesses,
  judgeSamples,
  models,
  modelVersions,
  resultConfigurations,
  rubricDimensions,
  runs,
  showcases,
  users,
} from "@/db/schema";
import type { z } from "zod";
import {
  containsControlCharacters,
  detectSecretLabels,
  showcaseDraftSchema,
  slugify,
} from "@/lib/security/policy";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import {
  normalizeReasoning,
  resultConfigurationIdentityMaterial,
} from "@/lib/data/result-metadata";
import { publicResultStatus } from "@/lib/domain/result-status";
import { hasApprovedPublicResultEvidence } from "@/lib/domain/result-evidence";
import { declaredResultProvenance } from "@/lib/domain/result-provenance";
import { assertSubmissionUsesFrozenTestPrompt } from "@/lib/domain/community-test-versioning";
import { getCurrentPublishedResultEvaluation } from "@/lib/data/results";
import { buildResultArtifactUrl } from "@/lib/security/usercontent";

export class SensitiveContentError extends Error {
  readonly status = 400;

  constructor(readonly labels: string[]) {
    super(
      "Potential credentials were detected. Remove secrets before saving this report.",
    );
    this.name = "SensitiveContentError";
  }
}

export async function createShowcaseDraft(
  ownerId: string,
  input: z.infer<typeof showcaseDraftSchema>,
) {
  const parsed = showcaseDraftSchema.parse(input);
  const combinedText = [
    parsed.title,
    parsed.summary,
    parsed.prompt,
    parsed.systemPrompt,
  ].join("\n");
  if (containsControlCharacters(combinedText)) {
    throw new Error("Submission text contains unsupported control characters.");
  }
  const secretLabels = detectSecretLabels(combinedText);
  if (secretLabels.length > 0) throw new SensitiveContentError(secretLabels);

  const now = new Date();
  const id = crypto.randomUUID();
  const slug = `${slugify(parsed.title)}-${id.slice(0, 8)}`;
  const [benchmarkVersion, modelVersion, harness] = await Promise.all([
    getDb()
      .select({
        id: benchmarkVersions.id,
        category: benchmarkVersions.category,
        canonicalPrompt: benchmarkVersions.canonicalPrompt,
      })
      .from(benchmarkVersions)
      .innerJoin(
        benchmarks,
        eq(benchmarks.id, benchmarkVersions.benchmarkId),
      )
      .where(
        and(
          eq(benchmarkVersions.id, parsed.benchmarkVersionId),
          sql`${benchmarkVersions.publishedAt} IS NOT NULL`,
        ),
      )
      .limit(1),
    parsed.modelVersionId
      ? getDb()
          .select({
            id: modelVersions.id,
            modelLabel: models.name,
            versionLabel: modelVersions.versionLabel,
          })
          .from(modelVersions)
          .innerJoin(models, eq(models.id, modelVersions.modelId))
          .where(eq(modelVersions.id, parsed.modelVersionId))
          .limit(1)
      : Promise.resolve([]),
    parsed.harnessId
      ? getDb()
          .select({
            id: harnesses.id,
            name: harnesses.name,
            version: harnesses.version,
          })
          .from(harnesses)
          .where(eq(harnesses.id, parsed.harnessId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  if (!benchmarkVersion[0]) {
    throw new ShowcaseNotPublishableError("Choose a published test version.");
  }
  assertSubmissionUsesFrozenTestPrompt(
    parsed.prompt,
    benchmarkVersion[0].canonicalPrompt,
  );
  const canonicalModelVersion =
    modelVersion[0]?.versionLabel !== "Unspecified" &&
    modelVersion[0]?.versionLabel === parsed.modelVersionLabel &&
    modelVersion[0]?.modelLabel === parsed.modelLabel
      ? modelVersion[0]
      : null;
  const selectedHarness = harness[0];
  const selectedHarnessLabel = selectedHarness
    ? `${selectedHarness.name} v${selectedHarness.version}`
    : null;
  const canonicalHarness =
    selectedHarness &&
    (parsed.harness === selectedHarness.name ||
      parsed.harness === selectedHarnessLabel)
      ? selectedHarness
      : null;
  const harnessLabel = canonicalHarness
    ? selectedHarnessLabel!
    : parsed.harness;
  const reasoningNormalized = normalizeReasoning(parsed.reasoningLevel);
  const declaredSettingsJson = canonicalJson(parsed.declaredSettings);
  const metadata = resultConfigurationIdentityMaterial({
    declaredSettings: parsed.declaredSettings,
    harnessId: canonicalHarness?.id ?? null,
    harnessLabel,
    modelLabel: parsed.modelLabel,
    modelVersionId: canonicalModelVersion?.id ?? null,
    modelVersionLabel: parsed.modelVersionLabel,
    reasoningNormalized,
  });
  const metadataHash = await canonicalSha256(metadata);
  const canonicalConfiguration =
    canonicalModelVersion && canonicalHarness
      ? await getDb()
          .select({ id: resultConfigurations.id })
          .from(resultConfigurations)
          .where(
            and(
              eq(
                resultConfigurations.modelVersionId,
                canonicalModelVersion.id,
              ),
              eq(resultConfigurations.harnessId, canonicalHarness.id),
              eq(
                resultConfigurations.reasoningNormalized,
                reasoningNormalized,
              ),
              eq(
                resultConfigurations.declaredSettingsJson,
                declaredSettingsJson,
              ),
              eq(resultConfigurations.catalogStatus, "canonical"),
            ),
          )
          .limit(1)
      : [];
  let configurationId = canonicalConfiguration[0]?.id ?? null;
  if (!configurationId) {
    await getDb()
      .insert(resultConfigurations)
      .values({
        id: `result-config-${crypto.randomUUID()}`,
        modelVersionId: canonicalModelVersion?.id ?? null,
        harnessId: canonicalHarness?.id ?? null,
        modelLabel: parsed.modelLabel,
        modelVersionLabel: parsed.modelVersionLabel,
        harnessLabel,
        reasoningRaw: parsed.reasoningLevel,
        reasoningNormalized,
        declaredSettingsJson,
        metadataHash,
        catalogStatus:
          canonicalModelVersion && canonicalHarness ? "canonical" : "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [storedConfiguration] = await getDb()
      .select({ id: resultConfigurations.id })
      .from(resultConfigurations)
      .where(eq(resultConfigurations.metadataHash, metadataHash))
      .limit(1);
    configurationId = storedConfiguration?.id ?? null;
  }
  if (!configurationId) {
    throw new ShowcaseNotPublishableError(
      "The declared model configuration could not be saved.",
    );
  }
  const missingCatalogEntries = [
    !canonicalModelVersion
      ? { kind: "model-version" as const, label: parsed.modelVersionLabel }
      : null,
    !canonicalHarness
      ? { kind: "harness" as const, label: harnessLabel }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  for (const entry of missingCatalogEntries) {
    await getDb().insert(catalogRequests).values({
      id: crypto.randomUUID(),
      resultConfigurationId: configurationId,
      requesterUserId: ownerId,
      kind: entry.kind,
      requestedLabel: entry.label,
      normalizedLabel: entry.label.toLowerCase().replace(/\s+/g, " ").trim(),
      status: "pending",
      mappedEntityId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const [showcase] = await getDb()
    .insert(showcases)
    .values({
      id,
      ownerId,
      slug,
      title: parsed.title,
      summary: parsed.summary,
      category: benchmarkVersion[0].category,
      benchmarkVersionId: benchmarkVersion[0].id,
      resultConfigurationId: configurationId,
      modelLabel: parsed.modelLabel,
      harness: harnessLabel,
      reasoningLevel: parsed.reasoningLevel,
      prompt: parsed.prompt,
      systemPrompt: parsed.systemPrompt || null,
      status: "draft",
      safetyStatus: "pending",
      judgeStatus: "not_queued",
      rankingStatus:
        canonicalModelVersion && canonicalHarness
          ? "pending"
          : "catalog_pending",
      sourceVisibility: parsed.sourceVisibility,
      rightsAttestedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return showcase;
}

type PublicShowcasePageOptions = {
  category?: string;
  contributor?: string;
  limit?: number;
  model?: string;
  offset?: number;
  q?: string;
  reasoning?: string;
  status?: "delayed" | "not-ranked" | "pending" | "ranked";
};

export async function listPublicShowcasesPage(
  options: PublicShowcasePageOptions = {},
) {
  const currentEvaluation = await getCurrentPublishedResultEvaluation();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 24), 1), 50);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const publishedRankExists = sql`EXISTS (
    SELECT 1
    FROM result_leaderboard_entries
    JOIN result_leaderboard_snapshots
      ON result_leaderboard_snapshots.id = result_leaderboard_entries.snapshot_id
    WHERE result_leaderboard_entries.showcase_id = ${showcases.id}
      AND result_leaderboard_snapshots.status = 'published'
      AND result_leaderboard_snapshots.evaluation_version_id = ${currentEvaluation?.id ?? null}
  )`;
  const conditions: SQL[] = [
    eq(showcases.status, "published"),
    eq(showcases.safetyStatus, "approved"),
  ];
  const category = options.category?.trim();
  const contributor = containsNeedle(options.contributor);
  const model = containsNeedle(options.model);
  const query = containsNeedle(options.q);
  const reasoning = options.reasoning?.trim().toLowerCase();
  if (category) conditions.push(sql`${showcases.category} = ${category}`);
  if (contributor) {
    conditions.push(sql`instr(lower(${users.handle}), ${contributor}) > 0`);
  }
  if (model) {
    conditions.push(sql`(
      instr(lower(${showcases.modelLabel}), ${model}) > 0
      OR instr(lower(${resultConfigurations.modelVersionLabel}), ${model}) > 0
    )`);
  }
  if (reasoning) {
    conditions.push(sql`lower(${showcases.reasoningLevel}) = ${reasoning}`);
  }
  if (query) {
    conditions.push(sql`(
      instr(lower(${showcases.title}), ${query}) > 0
      OR instr(lower(${showcases.summary}), ${query}) > 0
      OR instr(lower(${showcases.modelLabel}), ${query}) > 0
      OR instr(lower(${resultConfigurations.modelVersionLabel}), ${query}) > 0
      OR instr(lower(${showcases.harness}), ${query}) > 0
      OR instr(lower(${users.handle}), ${query}) > 0
    )`);
  }
  if (options.status === "ranked") {
    conditions.push(publishedRankExists);
  } else if (options.status === "delayed") {
    conditions.push(
      sql`NOT ${publishedRankExists}`,
      eq(showcases.judgeStatus, "overdue"),
    );
  } else if (options.status === "pending") {
    conditions.push(
      sql`NOT ${publishedRankExists}`,
      inArray(showcases.judgeStatus, [
        "not_queued",
        "queued",
        "evaluating",
        "judging",
      ]),
    );
  } else if (options.status === "not-ranked") {
    conditions.push(
      sql`NOT ${publishedRankExists}`,
      inArray(showcases.judgeStatus, ["scored", "unranked", "failed"]),
    );
  }
  const rows = await getDb()
    .select({
      id: showcases.id,
      slug: showcases.slug,
      title: showcases.title,
      summary: showcases.summary,
      category: showcases.category,
      modelLabel: showcases.modelLabel,
      harness: showcases.harness,
      declaredSettingsJson: resultConfigurations.declaredSettingsJson,
      configurationHash: resultConfigurations.metadataHash,
      reasoningLevel: showcases.reasoningLevel,
      judgeStatus: showcases.judgeStatus,
      rankingStatus: showcases.rankingStatus,
      judgeDueAt: showcases.judgeDueAt,
      scoreBps: sql<number | null>`CASE
        WHEN ${runs.evaluationVersionId} = ${currentEvaluation?.id ?? null}
          THEN ${runs.overallScoreBps}
        ELSE NULL
      END`,
      storedScoreBps: runs.overallScoreBps,
      runEvaluationVersionId: runs.evaluationVersionId,
      rank: sql<number | null>`(
        SELECT result_leaderboard_entries.rank
        FROM result_leaderboard_entries
        JOIN result_leaderboard_snapshots
          ON result_leaderboard_snapshots.id = result_leaderboard_entries.snapshot_id
        WHERE result_leaderboard_entries.showcase_id = ${showcases.id}
          AND result_leaderboard_snapshots.status = 'published'
          AND result_leaderboard_snapshots.evaluation_version_id = ${currentEvaluation?.id ?? null}
        ORDER BY result_leaderboard_snapshots.published_at DESC
        LIMIT 1
      )`,
      sourceVisibility: showcases.sourceVisibility,
      publishedAt: showcases.publishedAt,
      contributorHandle: users.handle,
      contributorName: users.displayName,
    })
    .from(showcases)
    .innerJoin(users, eq(showcases.ownerId, users.id))
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .leftJoin(runs, eq(runs.showcaseId, showcases.id))
    .where(and(...conditions))
    .orderBy(desc(showcases.publishedAt), desc(showcases.id))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map((row) => {
      const {
        runEvaluationVersionId,
        storedScoreBps,
        ...publicRow
      } = row;
      const historicalEvaluation =
        storedScoreBps !== null &&
        runEvaluationVersionId !== null &&
        runEvaluationVersionId !== currentEvaluation?.id;
      return {
        ...publicRow,
        currentEvaluationVersion: currentEvaluation?.version ?? null,
        provenance: declaredResultProvenance,
        statusLabel: historicalEvaluation
          ? "Scored — not ranked (historical evaluation)"
          : publicResultStatus(row),
      };
    }),
    hasNext: rows.length > limit,
  };
}

export async function listPublicShowcases(limit = 24) {
  const page = await listPublicShowcasesPage({ limit });
  return page.items;
}

export async function listPublicShowcaseCardsPage(
  options: PublicShowcasePageOptions = {},
) {
  const page = await listPublicShowcasesPage(options);
  const rows = page.items;
  if (rows.length === 0) return { items: [], hasNext: page.hasNext };
  const artifactRows = await getDb()
    .select({
      showcaseId: artifacts.showcaseId,
      kind: artifacts.kind,
    })
    .from(artifacts)
    .where(
      and(
        inArray(
          artifacts.showcaseId,
          rows.map((row) => row.id),
        ),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    );
  const items = rows.map((row) => {
    const kinds = new Set(
      artifactRows
        .filter((artifact) => artifact.showcaseId === row.id)
        .map((artifact) => artifact.kind),
    );
    if (row.sourceVisibility === "private") kinds.delete("source");
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.summary,
      category: row.category,
      model: row.modelLabel,
      harness: row.harness,
      reasoning: row.reasoningLevel,
      status: row.statusLabel,
      scoreBps: row.scoreBps,
      rank: row.rank,
      trust: "Declared, unverified" as const,
      contributor: row.contributorHandle,
      published: row.publishedAt?.toISOString() ?? "Published",
      evidence: [...kinds].map(
        (kind) => kind.charAt(0).toUpperCase() + kind.slice(1),
      ),
    };
  });
  return { items, hasNext: page.hasNext };
}

export async function listPublicShowcaseCards(limit = 24) {
  const page = await listPublicShowcaseCardsPage({ limit });
  return page.items;
}

function containsNeedle(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export async function getPublicShowcaseBySlug(slug: string) {
  const currentEvaluation = await getCurrentPublishedResultEvaluation();
  const [row] = await getDb()
    .select({
      id: showcases.id,
      slug: showcases.slug,
      title: showcases.title,
      summary: showcases.summary,
      category: showcases.category,
      testTitle: benchmarkVersions.title,
      testSlug: benchmarks.slug,
      testVersion: benchmarkVersions.version,
      model: showcases.modelLabel,
      modelVersion: resultConfigurations.modelVersionLabel,
      harness: showcases.harness,
      reasoningNormalized: resultConfigurations.reasoningNormalized,
      reasoning: showcases.reasoningLevel,
      declaredSettingsJson: resultConfigurations.declaredSettingsJson,
      configurationHash: resultConfigurations.metadataHash,
      prompt: showcases.prompt,
      systemPrompt: showcases.systemPrompt,
      sourceVisibility: showcases.sourceVisibility,
      judgeStatus: showcases.judgeStatus,
      rankingStatus: showcases.rankingStatus,
      judgeDueAt: showcases.judgeDueAt,
      runId: runs.id,
      scoreBps: runs.overallScoreBps,
      evaluatedAt: runs.evaluatedAt,
      scoredAt: runs.scoredAt,
      evaluationVersion: evaluationVersions.version,
      judgeProvider: evaluationVersions.judgeProvider,
      judgeModel: evaluationVersions.judgeModel,
      judgeModelVersion: evaluationVersions.judgeModelVersion,
      promptTemplateHash: evaluationVersions.promptTemplateHash,
      rubricProtocolVersion: evaluationVersions.rubricProtocolVersion,
      calibrationSetHash: evaluationVersions.calibrationSetHash,
      rank: sql<number | null>`(
        SELECT result_leaderboard_entries.rank
        FROM result_leaderboard_entries
        JOIN result_leaderboard_snapshots
          ON result_leaderboard_snapshots.id = result_leaderboard_entries.snapshot_id
        WHERE result_leaderboard_entries.showcase_id = ${showcases.id}
          AND result_leaderboard_snapshots.status = 'published'
          AND result_leaderboard_snapshots.evaluation_version_id = ${currentEvaluation?.id ?? null}
        ORDER BY result_leaderboard_snapshots.published_at DESC
        LIMIT 1
      )`,
      publishedAt: showcases.publishedAt,
      contributor: users.handle,
    })
    .from(showcases)
    .innerJoin(users, eq(showcases.ownerId, users.id))
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .innerJoin(
      benchmarkVersions,
      eq(benchmarkVersions.id, showcases.benchmarkVersionId),
    )
    .innerJoin(benchmarks, eq(benchmarks.id, benchmarkVersions.benchmarkId))
    .leftJoin(runs, eq(runs.showcaseId, showcases.id))
    .leftJoin(
      evaluationVersions,
      eq(evaluationVersions.id, runs.evaluationVersionId),
    )
    .where(
      and(
        eq(showcases.slug, slug),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [artifactRows, dimensionRows, [sampleCountRow]] = await Promise.all([
    getDb()
      .select({
        id: artifacts.id,
        kind: artifacts.kind,
        fileName: artifacts.fileName,
        contentType: artifacts.contentType,
        byteSize: artifacts.byteSize,
        sha256: artifacts.sha256,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.showcaseId, row.id),
          eq(artifacts.quarantineStatus, "approved"),
        ),
      )
      .orderBy(artifacts.kind),
    row.runId
      ? getDb()
          .select({
            key: rubricDimensions.key,
            title: rubricDimensions.title,
            description: rubricDimensions.description,
            weightBps: rubricDimensions.weightBps,
            finalScoreBps: sql<number>`coalesce(${dimensionScores.adjustedCombinedScoreBps}, ${dimensionScores.originalCombinedScoreBps})`,
            reasoning: dimensionScores.reasoning,
          })
          .from(dimensionScores)
          .innerJoin(
            rubricDimensions,
            eq(rubricDimensions.id, dimensionScores.rubricDimensionId),
          )
          .where(eq(dimensionScores.runId, row.runId))
          .orderBy(rubricDimensions.ordinal)
      : Promise.resolve([]),
    row.runId
      ? getDb()
          .select({ count: sql<number>`count(*)` })
          .from(judgeSamples)
          .where(eq(judgeSamples.runId, row.runId))
      : Promise.resolve([{ count: 0 }]),
  ]);
  const {
    runId: _runId,
    evaluationVersion,
    judgeProvider,
    judgeModel,
    judgeModelVersion,
    promptTemplateHash,
    rubricProtocolVersion,
    calibrationSetHash,
    declaredSettingsJson,
    ...publicRow
  } = row;
  void _runId;
  return {
    ...publicRow,
    declaredSettings: JSON.parse(declaredSettingsJson) as unknown,
    provenance: declaredResultProvenance,
    evaluation:
      evaluationVersion === null
        ? null
        : {
            version: evaluationVersion,
            provider: judgeProvider,
            model: judgeModel,
            modelVersion: judgeModelVersion,
            promptTemplateHash,
            rubricProtocolVersion,
            calibrationSetHash,
            current: evaluationVersion === currentEvaluation?.version,
          },
    judgeSampleCount: Number(sampleCountRow?.count ?? 0),
    dimensions: dimensionRows,
    statusLabel:
      row.scoreBps !== null &&
      evaluationVersion !== null &&
      evaluationVersion !== currentEvaluation?.version
        ? `Scored — not ranked (historical evaluation v${evaluationVersion})`
        : publicResultStatus(row),
    artifacts: artifactRows.filter(
      (artifact) =>
        artifact.kind !== "source" || row.sourceVisibility === "public",
    ).map((artifact) => ({
      ...artifact,
      url: buildResultArtifactUrl(row.slug, artifact.id),
    })),
  };
}

export async function getPublicShowcaseArtifact(
  slug: string,
  artifactId: string,
) {
  const [artifact] = await getDb()
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      objectKey: artifacts.objectKey,
      contentType: artifacts.contentType,
      byteSize: artifacts.byteSize,
      sha256: artifacts.sha256,
    })
    .from(artifacts)
    .innerJoin(showcases, eq(artifacts.showcaseId, showcases.id))
    .innerJoin(users, eq(showcases.ownerId, users.id))
    .where(
      and(
        eq(showcases.slug, slug),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        eq(artifacts.id, artifactId),
        eq(artifacts.quarantineStatus, "approved"),
        isNotNull(artifacts.sha256),
        or(
          ne(artifacts.kind, "source"),
          eq(showcases.sourceVisibility, "public"),
        ),
      ),
    )
    .limit(1);
  return artifact ?? null;
}

export async function getPublicContributor(handle: string) {
  const [user] = await getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1);
  if (!user) return null;
  const [submissions, [ranked]] = await Promise.all([
    getDb()
    .select({
      slug: showcases.slug,
      title: showcases.title,
      category: showcases.category,
      model: showcases.modelLabel,
      publishedAt: showcases.publishedAt,
    })
    .from(showcases)
    .where(
      and(
        eq(showcases.ownerId, user.id),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
      ),
    )
    .orderBy(desc(showcases.publishedAt)),
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .where(
        and(
          eq(runs.contributorId, user.id),
          eq(runs.status, "published"),
          eq(runs.rankEligible, true),
        ),
      ),
  ]);
  return {
    ...user,
    submissions,
    rankedRunCount: Number(ranked?.count ?? 0),
  };
}

export async function getShowcaseForOwner(id: string, ownerId: string) {
  const [showcase] = await getDb()
    .select()
    .from(showcases)
    .where(and(eq(showcases.id, id), eq(showcases.ownerId, ownerId)))
    .limit(1);
  return showcase ?? null;
}

export async function listShowcasesForOwner(ownerId: string) {
  return getDb()
    .select({
      id: showcases.id,
      slug: showcases.slug,
      title: showcases.title,
      status: showcases.status,
      safetyStatus: showcases.safetyStatus,
      judgeStatus: showcases.judgeStatus,
      rankingStatus: showcases.rankingStatus,
      judgeDueAt: showcases.judgeDueAt,
      updatedAt: showcases.updatedAt,
    })
    .from(showcases)
    .where(eq(showcases.ownerId, ownerId))
    .orderBy(desc(showcases.updatedAt))
    .limit(100);
}

export async function getShowcaseArtifacts(id: string) {
  return getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.showcaseId, id))
    .orderBy(artifacts.createdAt, artifacts.id);
}

export async function markShowcaseScanning(id: string, ownerId: string) {
  await getDb()
    .update(showcases)
    .set({ safetyStatus: "scanning", updatedAt: new Date() })
    .where(and(eq(showcases.id, id), eq(showcases.ownerId, ownerId)));
}

export async function publishShowcase(id: string, ownerId: string) {
  const [draft] = await getDb()
    .select({ sourceVisibility: showcases.sourceVisibility })
    .from(showcases)
    .where(
      and(
        eq(showcases.id, id),
        eq(showcases.ownerId, ownerId),
        eq(showcases.status, "draft"),
      ),
    )
    .limit(1);
  if (!draft) {
    throw new ShowcaseNotPublishableError(
      "This draft cannot be published in its current state.",
    );
  }
  const artifactRows = await getShowcaseArtifacts(id);
  if (artifactRows.length === 0) {
    throw new ShowcaseNotPublishableError(
      "Add at least one evidence artifact before publishing.",
    );
  }
  if (artifactRows.some((artifact) => artifact.quarantineStatus !== "approved")) {
    throw new ShowcaseNotPublishableError(
      "All evidence must pass security scanning before publishing.",
    );
  }
  if (
    !hasApprovedPublicResultEvidence(
      artifactRows,
      draft.sourceVisibility,
    )
  ) {
    throw new ShowcaseNotPublishableError(
      "Add at least one approved public evidence artifact. Private source alone cannot publish a result.",
    );
  }
  const totalBytes = artifactRows.reduce(
    (total, artifact) => total + artifact.byteSize,
    0,
  );
  const maxBytes = 1024 * 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw new ShowcaseNotPublishableError(
      "The combined evidence exceeds the submission limit.",
    );
  }

  const [published] = await getDb()
    .update(showcases)
    .set({
      status: "published",
      safetyStatus: "approved",
      judgeStatus: "queued",
      judgeDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(showcases.id, id),
        eq(showcases.ownerId, ownerId),
        eq(showcases.status, "draft"),
        sql`NOT EXISTS (
          SELECT 1
          FROM artifacts publication_artifact
          WHERE publication_artifact.showcase_id = ${showcases.id}
            AND publication_artifact.quarantine_status <> 'approved'
        )`,
        sql`EXISTS (
          SELECT 1
          FROM artifacts public_artifact
          WHERE public_artifact.showcase_id = ${showcases.id}
            AND public_artifact.quarantine_status = 'approved'
            AND (
              public_artifact.kind <> 'source'
              OR ${showcases.sourceVisibility} = 'public'
            )
        )`,
        sql`(
          SELECT coalesce(sum(publication_size.byte_size), 0)
          FROM artifacts publication_size
          WHERE publication_size.showcase_id = ${showcases.id}
        ) <= ${maxBytes}`,
      ),
    )
    .returning();
  if (!published) {
    throw new ShowcaseNotPublishableError(
      "This draft cannot be published in its current state.",
    );
  }
  return published;
}

export async function hasApprovedPublicSource(showcaseId: string) {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.showcaseId, showcaseId),
        eq(artifacts.kind, "source"),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    );
  return Number(row?.count ?? 0) > 0;
}

export class ShowcaseNotPublishableError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ShowcaseNotPublishableError";
  }
}
