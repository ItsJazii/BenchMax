import { env } from "cloudflare:workers";
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artifacts,
  auditEvents,
  showcaseEnrichmentArtifacts,
  showcaseEnrichmentSpendRecords,
  showcaseEnrichments,
  showcases,
} from "@/db/schema";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { sha256Hex } from "@/lib/security/policy";
import { sandboxRateFromEnv } from "@/lib/data/result-spend";
import {
  showcaseEnrichmentMessage,
  type ShowcaseEnrichmentMessage,
} from "@/lib/pipeline/enrichment-messages";
import { sanitizeEnrichmentFailureCode } from "@/lib/pipeline/enrichment-policy";
import {
  configuredDailyEnrichmentBudget,
  EnrichmentBudgetConfigurationError,
  enrichmentBudgetConfigurationDeferralAuditId,
  enrichmentBudgetDeferralAuditId,
  enrichmentBudgetWindow,
  isEnrichmentBudgetExhausted,
} from "@/lib/pipeline/enrichment-budget";

const ZIP_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
] as const;
const ENRICHMENT_LEASE_MS = 5 * 60 * 1000;
const MICROS_PER_HOUR_DIVISOR = 3_600_000;

export type ShowcaseEnrichmentArtifactKind =
  | "screenshot"
  | "video"
  | "console"
  | "accessibility";

export type ShowcaseEnrichmentClaim =
  | { action: "execute"; attemptCount: number; leaseExpiresAt: Date }
  | { action: "defer"; retryAt: Date }
  | { action: "retry"; leaseExpiresAt: Date }
  | { action: "skip" };

export async function scheduleShowcaseEnrichment(
  showcaseId: string,
): Promise<{
  dispatchDeferred: boolean;
  eligible: boolean;
  enrichmentId: string | null;
}> {
  const enrichment = await ensureShowcaseEnrichment(showcaseId);
  if (!enrichment) {
    return {
      dispatchDeferred: false,
      eligible: false,
      enrichmentId: null,
    };
  }
  try {
    await enqueueShowcaseEnrichment(enrichment.id);
    return {
      dispatchDeferred: false,
      eligible: true,
      enrichmentId: enrichment.id,
    };
  } catch {
    // The durable queued row is intentionally retained. The scheduled
    // reconciliation sweep will retry dispatch without affecting publication.
    return {
      dispatchDeferred: true,
      eligible: true,
      enrichmentId: enrichment.id,
    };
  }
}

async function ensureShowcaseEnrichment(showcaseId: string) {
  const [source] = await getDb()
    .select({
      id: artifacts.id,
      sha256: artifacts.sha256,
    })
    .from(artifacts)
    .innerJoin(showcases, eq(showcases.id, artifacts.showcaseId))
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        eq(artifacts.kind, "source"),
        eq(artifacts.quarantineStatus, "approved"),
        inArray(artifacts.contentType, [...ZIP_CONTENT_TYPES]),
        isNotNull(artifacts.sha256),
      ),
    )
    .orderBy(asc(artifacts.createdAt), asc(artifacts.id))
    .limit(1);
  if (!source?.sha256) return null;

  const now = new Date();
  const id = crypto.randomUUID();
  await getDb()
    .insert(showcaseEnrichments)
    .values({
      id,
      showcaseId,
      sourceArtifactId: source.id,
      sourceSha256: source.sha256,
      status: "queued",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: showcaseEnrichments.showcaseId });
  const [row] = await getDb()
    .select({ id: showcaseEnrichments.id, status: showcaseEnrichments.status })
    .from(showcaseEnrichments)
    .where(eq(showcaseEnrichments.showcaseId, showcaseId))
    .limit(1);
  return row ?? null;
}

export async function enqueueShowcaseEnrichment(enrichmentId: string) {
  const queue = env.EVALUATE_QUEUE as unknown as Queue<ShowcaseEnrichmentMessage>;
  await queue.send(showcaseEnrichmentMessage(enrichmentId));
}

export async function reconcileShowcaseEnrichments(limit = 50) {
  const boundedLimit = Math.min(Math.max(limit, 1), 200);
  const candidates = await getDb()
    .select({ id: showcases.id })
    .from(showcases)
    .where(
      and(
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        sql`EXISTS (
          SELECT 1 FROM artifacts enrichment_source
          WHERE enrichment_source.showcase_id = ${showcases.id}
            AND enrichment_source.kind = 'source'
            AND enrichment_source.quarantine_status = 'approved'
            AND enrichment_source.content_type IN ('application/zip', 'application/x-zip-compressed')
            AND enrichment_source.sha256 IS NOT NULL
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM showcase_enrichments existing_enrichment
          WHERE existing_enrichment.showcase_id = ${showcases.id}
        )`,
      ),
    )
    .orderBy(asc(showcases.publishedAt), asc(showcases.id))
    .limit(boundedLimit);
  for (const candidate of candidates) {
    await ensureShowcaseEnrichment(candidate.id);
  }

  const now = new Date();
  await getDb()
    .update(showcaseEnrichments)
    .set({ status: "queued", leaseExpiresAt: null, updatedAt: now })
    .where(
      and(
        eq(showcaseEnrichments.status, "running"),
        lte(showcaseEnrichments.leaseExpiresAt, now),
      ),
    );

  const queued = await getDb()
    .select({ id: showcaseEnrichments.id })
    .from(showcaseEnrichments)
    .where(eq(showcaseEnrichments.status, "queued"))
    .orderBy(asc(showcaseEnrichments.updatedAt), asc(showcaseEnrichments.id))
    .limit(boundedLimit);
  const dispatched: string[] = [];
  const deferred: string[] = [];
  for (const row of queued) {
    try {
      await enqueueShowcaseEnrichment(row.id);
      dispatched.push(row.id);
    } catch {
      deferred.push(row.id);
    }
  }
  return { created: candidates.length, deferred, dispatched };
}

export async function claimShowcaseEnrichment(
  enrichmentId: string,
  now = new Date(),
): Promise<ShowcaseEnrichmentClaim> {
  const { dayStartedAt, nextDayStartedAt } = enrichmentBudgetWindow(now);
  let dailyBudgetMicrousd: number;
  try {
    dailyBudgetMicrousd = configuredDailyEnrichmentBudget();
  } catch (error) {
    if (error instanceof EnrichmentBudgetConfigurationError) {
      // Configuration must fail closed without consuming the durable queue
      // retry budget or turning an optional public preview terminally failed.
      await recordEnrichmentBudgetConfigurationDeferral({
        dayStartedAt,
        enrichmentId,
        nextDayStartedAt,
      });
      return { action: "defer", retryAt: nextDayStartedAt };
    }
    throw error;
  }
  const leaseExpiresAt = new Date(now.getTime() + ENRICHMENT_LEASE_MS);
  const [claimed] = await getDb()
    .update(showcaseEnrichments)
    .set({
      status: "running",
      attemptCount: sql`${showcaseEnrichments.attemptCount} + 1`,
      leaseExpiresAt,
      failureCode: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcaseEnrichments.id, enrichmentId),
        or(
          eq(showcaseEnrichments.status, "queued"),
          and(
            eq(showcaseEnrichments.status, "running"),
            lte(showcaseEnrichments.leaseExpiresAt, now),
          ),
        ),
        sql`(
          SELECT coalesce(sum(${showcaseEnrichmentSpendRecords.costMicrousd}), 0)
          FROM ${showcaseEnrichmentSpendRecords}
          WHERE ${showcaseEnrichmentSpendRecords.createdAt} >= ${dayStartedAt.getTime()}
            AND ${showcaseEnrichmentSpendRecords.createdAt} < ${nextDayStartedAt.getTime()}
        ) < ${dailyBudgetMicrousd}`,
      ),
    )
    .returning({ attemptCount: showcaseEnrichments.attemptCount });
  if (claimed) {
    return {
      action: "execute",
      attemptCount: claimed.attemptCount,
      leaseExpiresAt,
    };
  }
  const [existing] = await getDb()
    .select({
      leaseExpiresAt: showcaseEnrichments.leaseExpiresAt,
      spentMicrousd: sql<number>`(
        SELECT coalesce(sum(${showcaseEnrichmentSpendRecords.costMicrousd}), 0)
        FROM ${showcaseEnrichmentSpendRecords}
        WHERE ${showcaseEnrichmentSpendRecords.createdAt} >= ${dayStartedAt.getTime()}
          AND ${showcaseEnrichmentSpendRecords.createdAt} < ${nextDayStartedAt.getTime()}
      )`,
      status: showcaseEnrichments.status,
    })
    .from(showcaseEnrichments)
    .where(eq(showcaseEnrichments.id, enrichmentId))
    .limit(1);
  if (
    existing &&
    (existing.status === "queued" ||
      (existing.status === "running" &&
        existing.leaseExpiresAt &&
        existing.leaseExpiresAt <= now)) &&
    isEnrichmentBudgetExhausted(
      Number(existing.spentMicrousd),
      dailyBudgetMicrousd,
    )
  ) {
    if (existing.status === "running") {
      await getDb()
        .update(showcaseEnrichments)
        .set({ status: "queued", leaseExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(showcaseEnrichments.id, enrichmentId),
            eq(showcaseEnrichments.status, "running"),
            lte(showcaseEnrichments.leaseExpiresAt, now),
          ),
        );
    }
    await recordEnrichmentBudgetDeferral({
      budgetMicrousd: dailyBudgetMicrousd,
      dayStartedAt,
      enrichmentId,
      nextDayStartedAt,
      spentMicrousd: Number(existing.spentMicrousd),
    });
    return { action: "defer", retryAt: nextDayStartedAt };
  }
  if (existing?.status === "running" && existing.leaseExpiresAt) {
    return { action: "retry", leaseExpiresAt: existing.leaseExpiresAt };
  }
  return { action: "skip" };
}

async function recordEnrichmentBudgetConfigurationDeferral(input: {
  dayStartedAt: Date;
  enrichmentId: string;
  nextDayStartedAt: Date;
}) {
  await getDb()
    .insert(auditEvents)
    .values({
      id: enrichmentBudgetConfigurationDeferralAuditId(
        input.enrichmentId,
        input.dayStartedAt,
      ),
      actorUserId: null,
      entityId: input.enrichmentId,
      entityType: "showcase-enrichment",
      action: "showcase.preview_enrichment_budget_configuration_deferred",
      metadataJson: canonicalJson({
        dayStartedAt: input.dayStartedAt.toISOString(),
        reason: "invalid-runtime-configuration",
        retryAt: input.nextDayStartedAt.toISOString(),
      }),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: auditEvents.id });
}

async function recordEnrichmentBudgetDeferral(input: {
  budgetMicrousd: number;
  dayStartedAt: Date;
  enrichmentId: string;
  nextDayStartedAt: Date;
  spentMicrousd: number;
}) {
  await getDb()
    .insert(auditEvents)
    .values({
      id: enrichmentBudgetDeferralAuditId(
        input.enrichmentId,
        input.dayStartedAt,
      ),
      actorUserId: null,
      entityId: input.enrichmentId,
      entityType: "showcase-enrichment",
      action: "showcase.preview_enrichment_budget_deferred",
      metadataJson: canonicalJson({
        budgetMicrousd: input.budgetMicrousd,
        dayStartedAt: input.dayStartedAt.toISOString(),
        retryAt: input.nextDayStartedAt.toISOString(),
        spentMicrousd: input.spentMicrousd,
      }),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: auditEvents.id });
}

export async function readShowcaseEnrichmentContract(enrichmentId: string) {
  const [row] = await getDb()
    .select({
      enrichmentId: showcaseEnrichments.id,
      showcaseId: showcases.id,
      sourceArtifactId: artifacts.id,
      sourceByteSize: artifacts.byteSize,
      sourceContentType: artifacts.contentType,
      sourceObjectKey: artifacts.objectKey,
      sourceSha256: artifacts.sha256,
    })
    .from(showcaseEnrichments)
    .innerJoin(showcases, eq(showcases.id, showcaseEnrichments.showcaseId))
    .innerJoin(
      artifacts,
      and(
        eq(artifacts.id, showcaseEnrichments.sourceArtifactId),
        eq(artifacts.showcaseId, showcases.id),
        eq(artifacts.sha256, showcaseEnrichments.sourceSha256),
      ),
    )
    .where(
      and(
        eq(showcaseEnrichments.id, enrichmentId),
        eq(showcaseEnrichments.status, "running"),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        eq(artifacts.kind, "source"),
        eq(artifacts.quarantineStatus, "approved"),
        inArray(artifacts.contentType, [...ZIP_CONTENT_TYPES]),
        isNotNull(artifacts.sha256),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function persistShowcaseEnrichmentArtifact(input: {
  bytes: Uint8Array;
  enrichmentId: string;
  kind: ShowcaseEnrichmentArtifactKind;
  contentType: string;
}) {
  if (input.bytes.byteLength === 0) {
    throw new TypeError("Enrichment artifacts must not be empty.");
  }
  const sha256 = await sha256Hex(input.bytes.slice().buffer);
  const extension = enrichmentArtifactExtension(input.kind);
  const objectKey = `enrichments/${input.enrichmentId}/${input.kind}.${extension}`;
  await env.UPLOADS.put(objectKey, input.bytes, {
    httpMetadata: { contentType: input.contentType },
    customMetadata: {
      automatedEnrichment: "true",
      enrichmentId: input.enrichmentId,
      sha256,
    },
  });
  const now = new Date();
  const [row] = await getDb()
    .insert(showcaseEnrichmentArtifacts)
    .values({
      id: crypto.randomUUID(),
      enrichmentId: input.enrichmentId,
      kind: input.kind,
      objectKey,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      sha256,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        showcaseEnrichmentArtifacts.enrichmentId,
        showcaseEnrichmentArtifacts.kind,
      ],
      set: {
        objectKey,
        contentType: input.contentType,
        byteSize: input.bytes.byteLength,
        sha256,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function completeShowcaseEnrichment(
  enrichmentId: string,
  templateBuildHash: string,
) {
  const now = new Date();
  const [completed] = await getDb()
    .update(showcaseEnrichments)
    .set({
      status: "completed",
      templateBuildHash,
      leaseExpiresAt: null,
      failureCode: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcaseEnrichments.id, enrichmentId),
        eq(showcaseEnrichments.status, "running"),
      ),
    )
    .returning({ id: showcaseEnrichments.id });
  if (completed) return true;
  const [existing] = await getDb()
    .select({ status: showcaseEnrichments.status })
    .from(showcaseEnrichments)
    .where(eq(showcaseEnrichments.id, enrichmentId))
    .limit(1);
  return existing?.status === "completed";
}

export async function markShowcaseEnrichmentNotApplicable(
  enrichmentId: string,
) {
  const now = new Date();
  await getDb()
    .update(showcaseEnrichments)
    .set({
      status: "not_applicable",
      leaseExpiresAt: null,
      failureCode: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcaseEnrichments.id, enrichmentId),
        eq(showcaseEnrichments.status, "running"),
      ),
    );
}

export async function recordShowcaseEnrichmentFailure(input: {
  code: string;
  enrichmentId: string;
  terminal: boolean;
}) {
  const now = new Date();
  await getDb()
    .update(showcaseEnrichments)
    .set({
      status: input.terminal ? "failed" : "queued",
      leaseExpiresAt: null,
      failureCode: sanitizeEnrichmentFailureCode(input.code),
      completedAt: input.terminal ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcaseEnrichments.id, input.enrichmentId),
        inArray(showcaseEnrichments.status, ["running", "queued"]),
      ),
    );
}

export async function retryShowcaseEnrichment(
  showcaseId: string,
  ownerId: string,
) {
  const now = new Date();
  const [retried] = await getDb()
    .update(showcaseEnrichments)
    .set({
      status: "queued",
      leaseExpiresAt: null,
      failureCode: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcaseEnrichments.showcaseId, showcaseId),
        eq(showcaseEnrichments.status, "failed"),
        sql`EXISTS (
          SELECT 1 FROM showcases retry_showcase
          WHERE retry_showcase.id = ${showcaseEnrichments.showcaseId}
            AND retry_showcase.owner_id = ${ownerId}
            AND retry_showcase.status = 'published'
            AND retry_showcase.safety_status = 'approved'
        )`,
      ),
    )
    .returning({ id: showcaseEnrichments.id });
  if (!retried) return null;
  try {
    await enqueueShowcaseEnrichment(retried.id);
    return { dispatchDeferred: false, enrichmentId: retried.id };
  } catch {
    return { dispatchDeferred: true, enrichmentId: retried.id };
  }
}

export async function getPublicShowcaseEnrichment(showcaseId: string) {
  const [row] = await getDb()
    .select({
      id: showcaseEnrichments.id,
      status: showcaseEnrichments.status,
    })
    .from(showcaseEnrichments)
    .innerJoin(showcases, eq(showcases.id, showcaseEnrichments.showcaseId))
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const availability = enrichmentAvailability(row.status);
  const artifactRows =
    row.status === "completed"
      ? await getDb()
          .select({
            id: showcaseEnrichmentArtifacts.id,
            kind: showcaseEnrichmentArtifacts.kind,
            contentType: showcaseEnrichmentArtifacts.contentType,
            byteSize: showcaseEnrichmentArtifacts.byteSize,
            sha256: showcaseEnrichmentArtifacts.sha256,
          })
          .from(showcaseEnrichmentArtifacts)
          .where(eq(showcaseEnrichmentArtifacts.enrichmentId, row.id))
          .orderBy(asc(showcaseEnrichmentArtifacts.kind))
      : [];
  return { availability, artifacts: artifactRows };
}

export async function getOwnedShowcaseEnrichment(
  showcaseId: string,
  ownerId: string,
) {
  const [row] = await getDb()
    .select({
      id: showcaseEnrichments.id,
      status: showcaseEnrichments.status,
      attemptCount: showcaseEnrichments.attemptCount,
      failureCode: showcaseEnrichments.failureCode,
      updatedAt: showcaseEnrichments.updatedAt,
    })
    .from(showcaseEnrichments)
    .innerJoin(showcases, eq(showcases.id, showcaseEnrichments.showcaseId))
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.ownerId, ownerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function recordShowcaseEnrichmentSpend(input: {
  attemptKey: string;
  durationMs: number;
  enrichmentId: string;
  status: "completed" | "failed";
}) {
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
    throw new RangeError("Enrichment duration must be a nonnegative integer.");
  }
  const rateMicrousdPerHour = sandboxRateFromEnv();
  const pricingSnapshot = {
    currency: "USD",
    rate: {
      environmentVariable: "BENCHMAX_SANDBOX_MICROUSD_PER_HOUR",
      microusdPerHour: rateMicrousdPerHour,
    },
    source: "explicit-runtime-configuration",
    version: 1,
  } as const;
  const numerator = BigInt(input.durationMs) * BigInt(rateMicrousdPerHour);
  const cost = Number(
    (numerator + BigInt(MICROS_PER_HOUR_DIVISOR - 1)) /
      BigInt(MICROS_PER_HOUR_DIVISOR),
  );
  await getDb()
    .insert(showcaseEnrichmentSpendRecords)
    .values({
      id: crypto.randomUUID(),
      enrichmentId: input.enrichmentId,
      attemptKey: input.attemptKey,
      status: input.status,
      currency: "USD",
      costMicrousd: cost,
      durationMs: input.durationMs,
      pricingSnapshotJson: canonicalJson(pricingSnapshot),
      pricingSnapshotHash: await canonicalSha256(pricingSnapshot),
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: showcaseEnrichmentSpendRecords.attemptKey,
    });
}

function enrichmentAvailability(status: string) {
  if (status === "completed") return "available" as const;
  if (status === "failed") return "unavailable" as const;
  if (status === "not_applicable") return "not_applicable" as const;
  return "pending" as const;
}

function enrichmentArtifactExtension(kind: ShowcaseEnrichmentArtifactKind) {
  if (kind === "screenshot") return "png";
  if (kind === "video") return "webm";
  return "json";
}

export type { ShowcaseEnrichmentMessage };
