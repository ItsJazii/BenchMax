import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { runs, showcases } from "@/db/schema";
import { appendAuditEvent } from "@/lib/data/audit";
import { planLatestResultSupersession } from "@/lib/ranking/result-supersession";

export type ResultSnapshotScope = {
  benchmarkVersionId: string;
  evaluationVersionId: string;
};

export async function reconcileResultSupersessionForRun(runId: string) {
  const [current] = await getDb()
    .select({
      benchmarkVersionId: runs.benchmarkVersionId,
      contributorId: showcases.ownerId,
      evaluationVersionId: runs.evaluationVersionId,
      resultConfigurationId: showcases.resultConfigurationId,
    })
    .from(runs)
    .innerJoin(showcases, eq(showcases.id, runs.showcaseId))
    .where(eq(runs.id, runId))
    .limit(1);
  if (!current?.resultConfigurationId) return [] as ResultSnapshotScope[];

  const group = await getDb()
    .select({
      benchmarkVersionId: runs.benchmarkVersionId,
      createdAt: showcases.createdAt,
      evaluationVersionId: runs.evaluationVersionId,
      id: showcases.id,
      publishedAt: showcases.publishedAt,
      rankEligible: runs.rankEligible,
      rankingStatus: showcases.rankingStatus,
      runStatus: runs.status,
      safetyStatus: showcases.safetyStatus,
      status: showcases.status,
      supersededById: showcases.supersededById,
    })
    .from(showcases)
    .innerJoin(runs, eq(runs.showcaseId, showcases.id))
    .where(
      and(
        eq(showcases.ownerId, current.contributorId),
        eq(
          showcases.resultConfigurationId,
          current.resultConfigurationId,
        ),
        eq(runs.benchmarkVersionId, current.benchmarkVersionId),
        eq(runs.evaluationVersionId, current.evaluationVersionId),
      ),
    );

  const candidates = group.flatMap((row) => {
    if (
      row.status !== "published" ||
      row.safetyStatus !== "approved" ||
      !row.rankEligible ||
      (row.runStatus !== "scored" && row.runStatus !== "published") ||
      (row.rankingStatus !== "eligible" &&
        row.rankingStatus !== "superseded")
    ) {
      return [];
    }
    return [
      {
        ...row,
        rankingStatus: row.rankingStatus as "eligible" | "superseded",
      },
    ];
  });
  const plan = planLatestResultSupersession(candidates);
  for (const update of plan.updates) {
    const before = candidates.find((candidate) => candidate.id === update.id);
    if (!before) continue;
    const [changed] = await getDb()
      .update(showcases)
      .set({
        rankingStatus: update.rankingStatus,
        supersededById: update.supersededById,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(showcases.id, update.id),
          eq(showcases.rankingStatus, before.rankingStatus),
          before.supersededById
            ? eq(showcases.supersededById, before.supersededById)
            : isNull(showcases.supersededById),
        ),
      )
      .returning({ id: showcases.id });
    if (!changed) continue;
    await appendAuditEvent({
      actorUserId: null,
      entityType: "showcase",
      entityId: update.id,
      action:
        update.rankingStatus === "superseded"
          ? "showcase.ranking_superseded"
          : "showcase.ranking_restored",
      metadata: {
        previousRankingStatus: before.rankingStatus,
        supersededById: update.supersededById,
        winnerId: plan.winnerId,
      },
    });
  }

  const scopes = new Map<string, ResultSnapshotScope>();
  scopes.set(
    `${current.benchmarkVersionId}:${current.evaluationVersionId}`,
    {
      benchmarkVersionId: current.benchmarkVersionId,
      evaluationVersionId: current.evaluationVersionId,
    },
  );
  return [...scopes.values()];
}

export async function findResultRunIdForShowcase(showcaseId: string) {
  const [row] = await getDb()
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.showcaseId, showcaseId))
    .limit(1);
  return row?.id ?? null;
}

export async function enqueueResultRankingRefresh(
  runId: string,
  reason: string,
  idempotencyKey = crypto.randomUUID(),
) {
  await env.JUDGE_QUEUE.send({
    runId,
    stage: "publish",
    stageVersion: `ranking-${reason}-${idempotencyKey}`,
  });
}

export async function repairStaleResultRankingRefreshes(limit = 50) {
  const rows = await env.DB.prepare(
    `WITH ranking_state AS (
       SELECT
         r.id,
         printf('%d-%d', r.updated_at, s.updated_at) AS change_token,
         CASE WHEN r.status IN ('scored', 'published')
                   AND r.rank_eligible = 1
                   AND s.status = 'published'
                   AND s.safety_status = 'approved'
                   AND s.ranking_status = 'eligible'
              THEN 1 ELSE 0 END AS should_rank,
         EXISTS (
           SELECT 1
           FROM result_leaderboard_entries entry
           JOIN result_leaderboard_snapshots snapshot
             ON snapshot.id = entry.snapshot_id
           WHERE entry.run_id = r.id
             AND snapshot.benchmark_version_id = r.benchmark_version_id
             AND snapshot.evaluation_version_id = r.evaluation_version_id
             AND snapshot.status = 'published'
         ) AS is_ranked,
         EXISTS (
           SELECT 1
           FROM result_leaderboard_entries entry
           JOIN result_leaderboard_snapshots snapshot
             ON snapshot.id = entry.snapshot_id
           WHERE entry.run_id = r.id
             AND snapshot.benchmark_version_id = r.benchmark_version_id
             AND snapshot.evaluation_version_id = r.evaluation_version_id
             AND snapshot.status = 'published'
             AND (
               entry.score_bps <> r.overall_score_bps
               OR entry.sample_count <> CASE WHEN (
                 SELECT count(*) FROM judge_samples sample
                 WHERE sample.run_id = r.id
               ) >= 3 THEN 3 ELSE 1 END
             )
         ) AS entry_changed
       FROM runs r
       JOIN showcases s ON s.id = r.showcase_id
       WHERE r.status IN ('scored', 'published', 'disqualified')
     )
     SELECT id, change_token
     FROM ranking_state
     WHERE should_rank <> is_ranked OR entry_changed = 1
     ORDER BY id
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ change_token: string; id: string }>();
  for (const row of rows.results) {
    await enqueueResultRankingRefresh(
      row.id,
      "scheduled-repair",
      row.change_token,
    );
  }
  return rows.results.map((row) => row.id);
}
