import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artifacts,
  benchmarkVersions,
  catalogRequests,
  harnesses,
  modelVersions,
  resultConfigurations,
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
import { normalizeReasoning } from "@/lib/data/result-metadata";

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
      .select({ id: benchmarkVersions.id })
      .from(benchmarkVersions)
      .where(
        and(
          eq(benchmarkVersions.id, parsed.benchmarkVersionId),
          sql`${benchmarkVersions.publishedAt} IS NOT NULL`,
        ),
      )
      .limit(1),
    parsed.modelVersionId
      ? getDb()
          .select({ id: modelVersions.id })
          .from(modelVersions)
          .where(eq(modelVersions.id, parsed.modelVersionId))
          .limit(1)
      : Promise.resolve([]),
    parsed.harnessId
      ? getDb()
          .select({ id: harnesses.id })
          .from(harnesses)
          .where(eq(harnesses.id, parsed.harnessId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  if (!benchmarkVersion[0]) {
    throw new ShowcaseNotPublishableError("Choose a published test version.");
  }
  const reasoningNormalized = normalizeReasoning(parsed.reasoningLevel);
  const metadata = {
    declaredSettings: parsed.declaredSettings,
    harness: parsed.harness,
    harnessId: harness[0]?.id ?? null,
    model: parsed.modelLabel,
    modelVersion: parsed.modelVersionLabel,
    modelVersionId: modelVersion[0]?.id ?? null,
    reasoningNormalized,
    reasoningRaw: parsed.reasoningLevel,
  };
  const metadataHash = await canonicalSha256(metadata);
  const configurationId = `result-config-${metadataHash}`;
  await getDb()
    .insert(resultConfigurations)
    .values({
      id: configurationId,
      modelVersionId: modelVersion[0]?.id ?? null,
      harnessId: harness[0]?.id ?? null,
      modelLabel: parsed.modelLabel,
      modelVersionLabel: parsed.modelVersionLabel,
      harnessLabel: parsed.harness,
      reasoningRaw: parsed.reasoningLevel,
      reasoningNormalized,
      declaredSettingsJson: canonicalJson(parsed.declaredSettings),
      metadataHash,
      catalogStatus:
        modelVersion[0] && harness[0] ? "canonical" : "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const missingCatalogEntries = [
    !modelVersion[0]
      ? { kind: "model-version" as const, label: parsed.modelVersionLabel }
      : null,
    !harness[0]
      ? { kind: "harness" as const, label: parsed.harness }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  for (const entry of missingCatalogEntries) {
    await getDb().insert(catalogRequests).values({
      id: crypto.randomUUID(),
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
      category: parsed.category,
      benchmarkVersionId: benchmarkVersion[0].id,
      resultConfigurationId: configurationId,
      modelLabel: parsed.modelLabel,
      harness: parsed.harness,
      reasoningLevel: parsed.reasoningLevel,
      prompt: parsed.prompt,
      systemPrompt: parsed.systemPrompt || null,
      status: "draft",
      safetyStatus: "pending",
      judgeStatus: "not_queued",
      rankingStatus:
        modelVersion[0] && harness[0] ? "pending" : "catalog_pending",
      sourceVisibility: parsed.sourceVisibility,
      rightsAttestedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return showcase;
}

export async function listPublicShowcases(limit = 24) {
  return getDb()
    .select({
      id: showcases.id,
      slug: showcases.slug,
      title: showcases.title,
      summary: showcases.summary,
      category: showcases.category,
      modelLabel: showcases.modelLabel,
      harness: showcases.harness,
      reasoningLevel: showcases.reasoningLevel,
      judgeStatus: showcases.judgeStatus,
      rankingStatus: showcases.rankingStatus,
      judgeDueAt: showcases.judgeDueAt,
      scoreBps: runs.overallScoreBps,
      rank: sql<number | null>`(
        SELECT result_leaderboard_entries.rank
        FROM result_leaderboard_entries
        JOIN result_leaderboard_snapshots
          ON result_leaderboard_snapshots.id = result_leaderboard_entries.snapshot_id
        WHERE result_leaderboard_entries.showcase_id = ${showcases.id}
          AND result_leaderboard_snapshots.status = 'published'
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
    .leftJoin(runs, eq(runs.showcaseId, showcases.id))
    .where(
      and(
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(desc(showcases.publishedAt), desc(showcases.id))
    .limit(Math.min(Math.max(limit, 1), 50));
}

export async function listPublicShowcaseCards(limit = 24) {
  const rows = await listPublicShowcases(limit);
  if (rows.length === 0) return [];
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
  return rows.map((row) => {
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
      status: publicResultStatus(row),
      scoreBps: row.scoreBps,
      rank: row.rank,
      trust: "Community Showcase" as const,
      contributor: row.contributorHandle,
      published: row.publishedAt?.toISOString() ?? "Published",
      evidence: [...kinds].map(
        (kind) => kind.charAt(0).toUpperCase() + kind.slice(1),
      ),
    };
  });
}

export async function getPublicShowcaseBySlug(slug: string) {
  const [row] = await getDb()
    .select({
      id: showcases.id,
      slug: showcases.slug,
      title: showcases.title,
      summary: showcases.summary,
      category: showcases.category,
      model: showcases.modelLabel,
      harness: showcases.harness,
      reasoning: showcases.reasoningLevel,
      prompt: showcases.prompt,
      systemPrompt: showcases.systemPrompt,
      sourceVisibility: showcases.sourceVisibility,
      judgeStatus: showcases.judgeStatus,
      rankingStatus: showcases.rankingStatus,
      judgeDueAt: showcases.judgeDueAt,
      scoreBps: runs.overallScoreBps,
      rank: sql<number | null>`(
        SELECT result_leaderboard_entries.rank
        FROM result_leaderboard_entries
        JOIN result_leaderboard_snapshots
          ON result_leaderboard_snapshots.id = result_leaderboard_entries.snapshot_id
        WHERE result_leaderboard_entries.showcase_id = ${showcases.id}
          AND result_leaderboard_snapshots.status = 'published'
        ORDER BY result_leaderboard_snapshots.published_at DESC
        LIMIT 1
      )`,
      publishedAt: showcases.publishedAt,
      contributor: users.handle,
    })
    .from(showcases)
    .innerJoin(users, eq(showcases.ownerId, users.id))
    .leftJoin(runs, eq(runs.showcaseId, showcases.id))
    .where(
      and(
        eq(showcases.slug, slug),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const artifactRows = await getDb()
    .select({
      kind: artifacts.kind,
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
    .orderBy(artifacts.kind);
  return {
    ...row,
    statusLabel: publicResultStatus(row),
    artifacts: artifactRows.filter(
      (artifact) =>
        artifact.kind !== "source" || row.sourceVisibility === "public",
    ),
  };
}

function publicResultStatus(input: {
  judgeDueAt: Date | null;
  judgeStatus: string;
  rank: number | null;
  rankingStatus: string;
}) {
  if (
    input.judgeStatus === "queued" ||
    input.judgeStatus === "evaluating" ||
    input.judgeStatus === "judging"
  ) {
    return "Public — pending AI review";
  }
  if (input.judgeStatus === "overdue") return "Delayed";
  if (input.judgeStatus === "failed") return "Scored — not ranked (review failed)";
  if (input.rank) return `Scored — ranked #${input.rank}`;
  if (input.judgeStatus === "scored") {
    return `Scored — not ranked (${input.rankingStatus.replace(/_/g, " ")})`;
  }
  return "Public — pending AI review";
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
    .where(and(eq(users.handle, handle), eq(users.status, "active")))
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
