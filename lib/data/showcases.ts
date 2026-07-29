import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts, runs, showcases, users } from "@/db/schema";
import type { z } from "zod";
import {
  containsControlCharacters,
  detectSecretLabels,
  showcaseDraftSchema,
  slugify,
} from "@/lib/security/policy";

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
  const [showcase] = await getDb()
    .insert(showcases)
    .values({
      id,
      ownerId,
      slug,
      title: parsed.title,
      summary: parsed.summary,
      category: parsed.category,
      modelLabel: parsed.modelLabel,
      harness: parsed.harness,
      reasoningLevel: parsed.reasoningLevel,
      prompt: parsed.prompt,
      systemPrompt: parsed.systemPrompt || null,
      status: "draft",
      safetyStatus: "pending",
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
      sourceVisibility: showcases.sourceVisibility,
      publishedAt: showcases.publishedAt,
      contributorHandle: users.handle,
      contributorName: users.displayName,
    })
    .from(showcases)
    .innerJoin(users, eq(showcases.ownerId, users.id))
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
      publishedAt: showcases.publishedAt,
      contributor: users.handle,
    })
    .from(showcases)
    .innerJoin(users, eq(showcases.ownerId, users.id))
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
    artifacts: artifactRows.filter(
      (artifact) =>
        artifact.kind !== "source" || row.sourceVisibility === "public",
    ),
  };
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
