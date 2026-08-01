import { env } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  evaluationVersions,
  models,
  modelVersions,
  resultAggregateEntries,
  resultAggregateSnapshots,
  resultConfigurations,
  resultLeaderboardEntries,
  resultLeaderboardSnapshots,
  showcases,
} from "@/db/schema";
import { canonicalSha256 } from "@/lib/security/canonical";
import {
  aggregateSnapshotMaterial,
  buildResultConfigurationSummaries,
  parseAggregateSourceSnapshotIds,
  planResultAggregateSnapshotWrite,
  type ResultConfigurationSummary,
} from "@/lib/ranking/result-aggregate-math";

export async function rebuildResultAggregateSnapshot(
  evaluationVersionId: string,
) {
  return rebuildResultAggregateSnapshotAttempt(evaluationVersionId, 0);
}

async function rebuildResultAggregateSnapshotAttempt(
  evaluationVersionId: string,
  attempt: number,
) {
  const summaries = await loadResultAggregateSummaries(evaluationVersionId);
  const sourceSetHash = await canonicalSha256(
    aggregateSnapshotMaterial(summaries),
  );
  const published = await persistResultAggregateSnapshot({
    evaluationVersionId,
    sourceSetHash,
    summaries,
  });
  const currentSummaries = await loadResultAggregateSummaries(
    evaluationVersionId,
  );
  const currentSourceSetHash = await canonicalSha256(
    aggregateSnapshotMaterial(currentSummaries),
  );
  if (currentSourceSetHash === sourceSetHash) return published;
  if (attempt >= 2) {
    throw new Error(
      "Result aggregate inputs changed repeatedly during publication; retry required.",
    );
  }
  return rebuildResultAggregateSnapshotAttempt(evaluationVersionId, attempt + 1);
}

async function loadResultAggregateSummaries(evaluationVersionId: string) {
  const rows = await getDb()
    .select({
      contributorId: showcases.ownerId,
      declaredSettingsJson: resultConfigurations.declaredSettingsJson,
      harnessLabel: resultConfigurations.harnessLabel,
      metadataHash: resultConfigurations.metadataHash,
      modelLabel: resultConfigurations.modelLabel,
      modelSlug: models.slug,
      modelVersionLabel: resultConfigurations.modelVersionLabel,
      reasoning: resultConfigurations.reasoningNormalized,
      resultConfigurationId: resultConfigurations.id,
      scoreBps: resultLeaderboardEntries.scoreBps,
      snapshotId: resultLeaderboardSnapshots.id,
      snapshotPublishedAt: resultLeaderboardSnapshots.publishedAt,
      testVersionId: resultLeaderboardSnapshots.benchmarkVersionId,
    })
    .from(resultLeaderboardEntries)
    .innerJoin(
      resultLeaderboardSnapshots,
      eq(resultLeaderboardSnapshots.id, resultLeaderboardEntries.snapshotId),
    )
    .innerJoin(
      showcases,
      eq(showcases.id, resultLeaderboardEntries.showcaseId),
    )
    .innerJoin(
      resultConfigurations,
      eq(resultConfigurations.id, showcases.resultConfigurationId),
    )
    .innerJoin(
      modelVersions,
      eq(modelVersions.id, resultConfigurations.modelVersionId),
    )
    .innerJoin(models, eq(models.id, modelVersions.modelId))
    .where(
      and(
        eq(resultLeaderboardSnapshots.status, "published"),
        eq(
          resultLeaderboardSnapshots.evaluationVersionId,
          evaluationVersionId,
        ),
        eq(resultConfigurations.catalogStatus, "canonical"),
      ),
    )
    .orderBy(
      resultConfigurations.id,
      resultLeaderboardSnapshots.benchmarkVersionId,
      resultLeaderboardEntries.showcaseId,
    );
  return buildResultConfigurationSummaries(
    rows.map(({ declaredSettingsJson, ...row }) => ({
      ...row,
      declaredSettings: JSON.parse(declaredSettingsJson) as unknown,
    })),
  );
}

async function persistResultAggregateSnapshot(input: {
  evaluationVersionId: string;
  sourceSetHash: string;
  summaries: readonly ResultConfigurationSummary[];
}) {
  const [existing] = await getDb()
    .select()
    .from(resultAggregateSnapshots)
    .where(
      and(
        eq(
          resultAggregateSnapshots.evaluationVersionId,
          input.evaluationVersionId,
        ),
        eq(resultAggregateSnapshots.sourceSetHash, input.sourceSetHash),
        inArray(resultAggregateSnapshots.status, ["building", "published"]),
      ),
    )
    .limit(1);
  const [latest] = await getDb()
    .select({ version: resultAggregateSnapshots.version })
    .from(resultAggregateSnapshots)
    .where(
      eq(
        resultAggregateSnapshots.evaluationVersionId,
        input.evaluationVersionId,
      ),
    )
    .orderBy(desc(resultAggregateSnapshots.version))
    .limit(1);
  const writePlan = planResultAggregateSnapshotWrite({
    existingStatus: existing?.status ?? null,
    existingVersion: existing?.version ?? null,
    latestVersion: latest?.version ?? null,
  });
  if (!writePlan.publish && existing) return existing;
  const now = Date.now();
  const snapshotId = existing?.id ?? crypto.randomUUID();
  const statements = [
    ...(existing?.status === "building"
      ? [
          env.DB.prepare(
            "DELETE FROM result_aggregate_entries WHERE snapshot_id = ?",
          ).bind(snapshotId),
        ]
      : existing
        ? []
        : [
            env.DB.prepare(
              `INSERT INTO result_aggregate_snapshots
               (id, evaluation_version_id, version, source_set_hash, status, published_at, created_at)
               VALUES (?, ?, ?, ?, 'building', NULL, ?)`,
            ).bind(
              snapshotId,
              input.evaluationVersionId,
              writePlan.version,
              input.sourceSetHash,
              now,
            ),
          ]),
    ...(writePlan.rewriteEntries
      ? input.summaries.map((summary) =>
          env.DB.prepare(
            `INSERT INTO result_aggregate_entries
             (id, snapshot_id, result_configuration_id, score_bps, q1_score_bps, q3_score_bps,
              test_coverage, contributor_count, provisional, source_snapshot_ids_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            snapshotId,
            summary.configurationId,
            summary.scoreBps,
            summary.q1ScoreBps,
            summary.q3ScoreBps,
            summary.testCoverage,
            summary.contributorCount,
            summary.provisional ? 1 : 0,
            JSON.stringify(summary.sourceSnapshotIds),
            now,
          ),
        )
      : []),
    env.DB.prepare(
      `UPDATE result_aggregate_snapshots
       SET status = 'superseded'
       WHERE evaluation_version_id = ? AND status = 'published'`,
    ).bind(input.evaluationVersionId),
    env.DB.prepare(
       `UPDATE result_aggregate_snapshots
       SET status = 'published', published_at = ?
       WHERE id = ? AND status = 'building'`,
    ).bind(now, snapshotId),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const [winner] = await getDb()
      .select()
      .from(resultAggregateSnapshots)
      .where(
        and(
          eq(
            resultAggregateSnapshots.evaluationVersionId,
            input.evaluationVersionId,
          ),
          eq(resultAggregateSnapshots.sourceSetHash, input.sourceSetHash),
          inArray(resultAggregateSnapshots.status, ["building", "published"]),
        ),
      )
      .limit(1);
    if (winner?.status === "published") return winner;
    throw error;
  }
  const [published] = await getDb()
    .select()
    .from(resultAggregateSnapshots)
    .where(eq(resultAggregateSnapshots.id, snapshotId))
    .limit(1);
  if (!published || published.status !== "published") {
    throw new Error("Result aggregate snapshot did not publish atomically.");
  }
  return published;
}

export async function readPublishedResultAggregate(
  evaluationVersionId: string,
  modelSlug?: string,
) {
  const [snapshot] = await getDb()
    .select({
      evaluationVersion: evaluationVersions.version,
      id: resultAggregateSnapshots.id,
      publishedAt: resultAggregateSnapshots.publishedAt,
      sourceSetHash: resultAggregateSnapshots.sourceSetHash,
      version: resultAggregateSnapshots.version,
    })
    .from(resultAggregateSnapshots)
    .innerJoin(
      evaluationVersions,
      eq(evaluationVersions.id, resultAggregateSnapshots.evaluationVersionId),
    )
    .where(
      and(
        eq(resultAggregateSnapshots.status, "published"),
        eq(
          resultAggregateSnapshots.evaluationVersionId,
          evaluationVersionId,
        ),
      ),
    )
    .orderBy(desc(evaluationVersions.version), desc(resultAggregateSnapshots.version))
    .limit(1);
  if (!snapshot) return null;

  const rows = await getDb()
    .select({
      configurationId: resultAggregateEntries.resultConfigurationId,
      contributorCount: resultAggregateEntries.contributorCount,
      declaredSettingsJson: resultConfigurations.declaredSettingsJson,
      harnessLabel: resultConfigurations.harnessLabel,
      metadataHash: resultConfigurations.metadataHash,
      modelLabel: resultConfigurations.modelLabel,
      modelSlug: models.slug,
      modelVersionLabel: resultConfigurations.modelVersionLabel,
      provisional: resultAggregateEntries.provisional,
      q1ScoreBps: resultAggregateEntries.q1ScoreBps,
      q3ScoreBps: resultAggregateEntries.q3ScoreBps,
      reasoning: resultConfigurations.reasoningNormalized,
      scoreBps: resultAggregateEntries.scoreBps,
      sourceSnapshotIdsJson: resultAggregateEntries.sourceSnapshotIdsJson,
      testCoverage: resultAggregateEntries.testCoverage,
    })
    .from(resultAggregateEntries)
    .innerJoin(
      resultConfigurations,
      eq(
        resultConfigurations.id,
        resultAggregateEntries.resultConfigurationId,
      ),
    )
    .innerJoin(
      modelVersions,
      eq(modelVersions.id, resultConfigurations.modelVersionId),
    )
    .innerJoin(models, eq(models.id, modelVersions.modelId))
    .where(
      and(
        eq(resultAggregateEntries.snapshotId, snapshot.id),
        ...(modelSlug ? [eq(models.slug, modelSlug)] : []),
      ),
    )
    .orderBy(
      desc(resultAggregateEntries.scoreBps),
      desc(resultAggregateEntries.testCoverage),
      resultAggregateEntries.resultConfigurationId,
    );
  const summaries: ResultConfigurationSummary[] = rows.map((row) => ({
    configurationId: row.configurationId,
    contributorCount: row.contributorCount,
    declaredSettings: JSON.parse(row.declaredSettingsJson) as unknown,
    harnessLabel: row.harnessLabel,
    metadataHash: row.metadataHash,
    modelLabel: row.modelLabel,
    modelSlug: row.modelSlug,
    modelVersionLabel: row.modelVersionLabel,
    provisional: row.provisional,
    q1ScoreBps: row.q1ScoreBps,
    q3ScoreBps: row.q3ScoreBps,
    reasoning: row.reasoning,
    scoreBps: row.scoreBps,
    snapshotDate: snapshot.publishedAt,
    sourceSnapshotIds: parseAggregateSourceSnapshotIds(
      row.sourceSnapshotIdsJson,
    ),
    testCoverage: row.testCoverage,
  }));
  return {
    evaluationVersion: snapshot.evaluationVersion,
    snapshotDate: snapshot.publishedAt,
    snapshotHash: snapshot.sourceSetHash,
    snapshotVersion: snapshot.version,
    summaries,
  };
}
