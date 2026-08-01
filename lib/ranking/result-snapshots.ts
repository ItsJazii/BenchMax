import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  judgeSamples,
  evaluationVersions,
  resultLeaderboardEntries,
  resultLeaderboardSnapshots,
  runs,
  showcases,
} from "@/db/schema";
import { canonicalSha256 } from "@/lib/security/canonical";
import { rankResultRows } from "@/lib/ranking/result-ranking";
import { rebuildResultAggregateSnapshot } from "@/lib/ranking/result-aggregate-snapshots";
import { hasPendingTopTenEscalations } from "@/lib/ranking/top-ten-gate";
import { transitionRun } from "@/lib/data/runs";
import {
  claimJudgeBudget,
  JudgeBudgetConfigurationError,
} from "@/lib/judging/budget";
import { TOP_TEN_ESCALATION_STAGE_VERSION } from "@/lib/pipeline/judge-dispatch";
import {
  claimRepairDispatchAttempt,
  FROZEN_EVALUATION_REPAIR_FAILURE_CODE,
  FROZEN_EVALUATION_REPAIR_FAILURE_SUMMARY,
  isActiveEvaluationVersion,
  REPAIR_MAX_ATTEMPTS,
  recordRepairDispatch,
} from "@/lib/pipeline/repair-backoff";
import { appendAuditEvent } from "@/lib/data/audit";

type TopTenEscalationCandidate = {
  evaluationStatus: string;
  evaluationVersionId: string;
  rank: number;
  runId: string;
  sampleCount: number;
  showcaseId: string;
};

export async function rebuildResultLeaderboard(input: {
  benchmarkVersionId: string;
  evaluationVersionId: string;
}) {
  const rows = await getDb()
    .select({
      runId: runs.id,
      scoreBps: runs.overallScoreBps,
      showcaseId: showcases.id,
      sampleCount: sql<number>`count(${judgeSamples.id})`,
    })
    .from(runs)
    .innerJoin(showcases, eq(showcases.id, runs.showcaseId))
    .leftJoin(judgeSamples, eq(judgeSamples.runId, runs.id))
    .where(
      and(
        eq(runs.benchmarkVersionId, input.benchmarkVersionId),
        eq(runs.evaluationVersionId, input.evaluationVersionId),
        inArray(runs.status, ["scored", "published"]),
        eq(runs.rankEligible, true),
        eq(showcases.status, "published"),
        eq(showcases.safetyStatus, "approved"),
        inArray(showcases.rankingStatus, ["eligible", "superseded"]),
        sql`NOT EXISTS (
          SELECT 1
          FROM showcases AS newer_showcase
          JOIN runs AS newer_run
            ON newer_run.showcase_id = newer_showcase.id
          WHERE newer_showcase.id <> ${showcases.id}
            AND newer_showcase.owner_id = ${showcases.ownerId}
            AND newer_showcase.result_configuration_id = ${showcases.resultConfigurationId}
            AND newer_showcase.benchmark_version_id = ${showcases.benchmarkVersionId}
            AND newer_showcase.status = 'published'
            AND newer_showcase.safety_status = 'approved'
            AND newer_showcase.ranking_status IN ('eligible', 'superseded')
            AND newer_run.rank_eligible = 1
            AND newer_run.evaluation_version_id = ${input.evaluationVersionId}
            AND (
              coalesce(newer_showcase.published_at, newer_showcase.created_at) >
                coalesce(${showcases.publishedAt}, ${showcases.createdAt})
              OR (
                coalesce(newer_showcase.published_at, newer_showcase.created_at) =
                  coalesce(${showcases.publishedAt}, ${showcases.createdAt})
                AND newer_showcase.id > ${showcases.id}
              )
            )
        )`,
      ),
    )
    .groupBy(runs.id, showcases.id)
    .orderBy(desc(runs.overallScoreBps), runs.id);
  const ranked = rankResultRows(rows);
  const topTenEscalationPending = hasPendingTopTenEscalations(ranked);
  const resultSetHash = await canonicalSha256(
    ranked.map(({ runId, scoreBps, showcaseId, sampleCount }) => ({
      runId,
      scoreBps,
      showcaseId,
      sampleCount,
    })),
  );
  const [existing] = await getDb()
    .select()
    .from(resultLeaderboardSnapshots)
    .where(
      and(
        eq(
          resultLeaderboardSnapshots.benchmarkVersionId,
          input.benchmarkVersionId,
        ),
        eq(
          resultLeaderboardSnapshots.evaluationVersionId,
          input.evaluationVersionId,
        ),
        eq(resultLeaderboardSnapshots.resultSetHash, resultSetHash),
        inArray(resultLeaderboardSnapshots.status, ["building", "published"]),
      ),
    )
    .limit(1);
  if (existing?.status === "published") {
    if (topTenEscalationPending) {
      await env.DB.prepare(
        `UPDATE result_leaderboard_snapshots
         SET status = 'superseded'
         WHERE id = ? AND status = 'published'`,
      )
        .bind(existing.id)
        .run();
      await rebuildResultAggregateSnapshot(input.evaluationVersionId);
      await enqueueTopTenEscalations(
        ranked.map((row) => ({
          ...row,
          evaluationStatus: "active",
          evaluationVersionId: input.evaluationVersionId,
        })),
      );
      return { ...existing, status: "superseded" as const };
    } else {
      await rebuildResultAggregateSnapshot(input.evaluationVersionId);
    }
    return existing;
  }
  const [latest] = await getDb()
    .select({ version: resultLeaderboardSnapshots.version })
    .from(resultLeaderboardSnapshots)
    .where(
      and(
        eq(
          resultLeaderboardSnapshots.benchmarkVersionId,
          input.benchmarkVersionId,
        ),
        eq(
          resultLeaderboardSnapshots.evaluationVersionId,
          input.evaluationVersionId,
        ),
      ),
    )
    .orderBy(desc(resultLeaderboardSnapshots.version))
    .limit(1);
  const now = Date.now();
  const snapshotId = existing?.id ?? crypto.randomUUID();
  const statements = [
    ...(existing
      ? [
          env.DB.prepare(
            `DELETE FROM result_leaderboard_entries WHERE snapshot_id = ?`,
          ).bind(snapshotId),
        ]
      : [
          env.DB.prepare(
            `INSERT INTO result_leaderboard_snapshots
             (id, benchmark_version_id, evaluation_version_id, version, result_set_hash, status, published_at, created_at)
             VALUES (?, ?, ?, ?, ?, 'building', NULL, ?)`,
          ).bind(
            snapshotId,
            input.benchmarkVersionId,
            input.evaluationVersionId,
            (latest?.version ?? 0) + 1,
            resultSetHash,
            now,
          ),
        ]),
    ...ranked.map((row) =>
          env.DB.prepare(
            `INSERT INTO result_leaderboard_entries
             (id, snapshot_id, showcase_id, run_id, rank, score_bps, sample_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            snapshotId,
            row.showcaseId,
            row.runId,
            row.rank,
            row.scoreBps,
            row.sampleCount,
            now,
          ),
        ),
    ...(topTenEscalationPending
      ? []
      : [
          env.DB.prepare(
            `UPDATE result_leaderboard_snapshots
             SET status = 'superseded'
             WHERE benchmark_version_id = ? AND evaluation_version_id = ? AND status = 'published'`,
          ).bind(input.benchmarkVersionId, input.evaluationVersionId),
          env.DB.prepare(
             `UPDATE result_leaderboard_snapshots
             SET status = 'published', published_at = ?
             WHERE id = ? AND status = 'building'`,
          ).bind(now, snapshotId),
        ]),
  ];
  if (topTenEscalationPending) {
    await enqueueTopTenEscalations(
      ranked.map((row) => ({
        ...row,
        evaluationStatus: "active",
        evaluationVersionId: input.evaluationVersionId,
      })),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const [winner] = await getDb()
      .select()
      .from(resultLeaderboardSnapshots)
      .where(
        and(
          eq(
            resultLeaderboardSnapshots.benchmarkVersionId,
            input.benchmarkVersionId,
          ),
          eq(
            resultLeaderboardSnapshots.evaluationVersionId,
            input.evaluationVersionId,
          ),
          eq(resultLeaderboardSnapshots.resultSetHash, resultSetHash),
          inArray(resultLeaderboardSnapshots.status, ["building", "published"]),
        ),
      )
      .limit(1);
    if (winner?.status === "published") {
      await rebuildResultAggregateSnapshot(input.evaluationVersionId);
      await enqueueTopTenEscalations(
        ranked.map((row) => ({
          ...row,
          evaluationStatus: "active",
          evaluationVersionId: input.evaluationVersionId,
        })),
      );
      return winner;
    }
    throw error;
  }
  const [published] = await getDb()
    .select()
    .from(resultLeaderboardSnapshots)
    .where(eq(resultLeaderboardSnapshots.id, snapshotId))
    .limit(1);
  if (!topTenEscalationPending) {
    await rebuildResultAggregateSnapshot(input.evaluationVersionId);
  }
  return published;
}

export async function repairBudgetPendingEscalations(limit = 50) {
  const candidates = await getDb()
    .select({
      evaluationStatus: evaluationVersions.status,
      evaluationVersionId: resultLeaderboardSnapshots.evaluationVersionId,
      rank: resultLeaderboardEntries.rank,
      runId: resultLeaderboardEntries.runId,
      sampleCount: sql<number>`(
        SELECT count(*)
        FROM judge_samples AS live_sample
        WHERE live_sample.run_id = ${resultLeaderboardEntries.runId}
          AND live_sample.evaluation_version_id = ${resultLeaderboardSnapshots.evaluationVersionId}
      )`,
      showcaseId: resultLeaderboardEntries.showcaseId,
    })
    .from(resultLeaderboardEntries)
    .innerJoin(
      resultLeaderboardSnapshots,
      eq(resultLeaderboardSnapshots.id, resultLeaderboardEntries.snapshotId),
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
    .innerJoin(runs, eq(runs.id, resultLeaderboardEntries.runId))
    .where(
      and(
        inArray(resultLeaderboardSnapshots.status, ["published", "building"]),
        inArray(evaluationVersions.status, ["active", "frozen"]),
        // Terminal repairs (markRepairFailure) set judgeStatus='failed'; without
        // this filter the sweep re-selects them every cron tick forever. The
        // run-status exclusions are the durable belt-and-braces: even if a
        // showcase label is ever left non-terminal, a run that already reached
        // a terminal status is never re-swept.
        ne(showcases.judgeStatus, "failed"),
        sql`${runs.status} NOT IN ('evaluation_failed', 'disqualified')`,
        sql`${resultLeaderboardEntries.rank} <= 10`,
        sql`(
          SELECT count(*)
          FROM judge_samples AS live_sample
          WHERE live_sample.run_id = ${resultLeaderboardEntries.runId}
            AND live_sample.evaluation_version_id = ${resultLeaderboardSnapshots.evaluationVersionId}
        ) < 3`,
        sql`NOT EXISTS (
          SELECT 1
          FROM result_leaderboard_snapshots AS newer_snapshot
          WHERE newer_snapshot.benchmark_version_id = ${resultLeaderboardSnapshots.benchmarkVersionId}
            AND newer_snapshot.evaluation_version_id = ${resultLeaderboardSnapshots.evaluationVersionId}
            AND newer_snapshot.status IN ('building', 'published')
            AND newer_snapshot.version > ${resultLeaderboardSnapshots.version}
        )`,
      ),
    )
    .orderBy(resultLeaderboardEntries.rank, resultLeaderboardEntries.runId)
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));
  await enqueueTopTenEscalations(candidates);
  return candidates.map((candidate) => candidate.runId);
}

async function enqueueTopTenEscalations(ranked: TopTenEscalationCandidate[]) {
  const candidates = ranked.filter(
    (row) => row.rank <= 10 && row.sampleCount < 3,
  );
  if (candidates.length === 0) return;
  const { env } = await import("cloudflare:workers");
  for (const candidate of candidates) {
    const [run] = await getDb()
      .select({
        contributorId: runs.contributorId,
        evaluationStatus: evaluationVersions.status,
        status: runs.status,
      })
      .from(runs)
      .innerJoin(
        evaluationVersions,
        eq(evaluationVersions.id, candidate.evaluationVersionId),
      )
      .where(
        and(
          eq(runs.id, candidate.runId),
          eq(runs.evaluationVersionId, candidate.evaluationVersionId),
        ),
      )
      .limit(1);
    if (!run) continue;
    if (run.evaluationStatus === "frozen") {
      await markRepairFailure({
        reason: FROZEN_EVALUATION_REPAIR_FAILURE_CODE,
        runId: candidate.runId,
        showcaseId: candidate.showcaseId,
      });
      continue;
    }
    if (!isActiveEvaluationVersion(run.evaluationStatus)) continue;
    const repairAttempt = await claimRepairDispatchAttempt({
      db: env.DB,
      runId: candidate.runId,
      stageVersion: TOP_TEN_ESCALATION_STAGE_VERSION,
    });
    if (repairAttempt.action === "skip") {
      if (repairAttempt.reason === "exhausted") {
        await markRepairFailure({
          reason: "repair_attempts_exhausted",
          runId: candidate.runId,
          showcaseId: candidate.showcaseId,
        });
      }
      continue;
    }
    let reservation:
      | Awaited<ReturnType<typeof claimJudgeBudget>>
      | undefined;
    try {
      reservation = await claimJudgeBudget({
        contributorId: run.contributorId,
        purpose: "top-ten-escalation",
        runId: candidate.runId,
        sampleCount: 3 - candidate.sampleCount,
      });
    } catch (error) {
      if (!(error instanceof JudgeBudgetConfigurationError)) throw error;
    }
    if (!reservation?.allowed) {
      await recordRepairDispatch({
        claimId: repairAttempt.claimId,
        db: env.DB,
        errorCode: "judge_budget_denied",
        outcome: "failed",
      });
      if (repairAttempt.attemptCount >= REPAIR_MAX_ATTEMPTS) {
        await markRepairFailure({
          reason: "repair_attempts_exhausted",
          runId: candidate.runId,
          showcaseId: candidate.showcaseId,
        });
      }
      continue;
    }
    await getDb()
      .update(showcases)
      .set({ judgeStatus: "judging", updatedAt: new Date() })
      .where(eq(showcases.id, candidate.showcaseId));
    try {
      await env.JUDGE_QUEUE.send({
        runId: candidate.runId,
        stage: "judge",
        stageVersion: TOP_TEN_ESCALATION_STAGE_VERSION,
      });
    } catch (error) {
      await recordRepairDispatch({
        claimId: repairAttempt.claimId,
        db: env.DB,
        errorCode: "queue_unavailable",
        outcome: "failed",
      });
      if (repairAttempt.attemptCount >= REPAIR_MAX_ATTEMPTS) {
        await markRepairFailure({
          reason: "repair_attempts_exhausted",
          runId: candidate.runId,
          showcaseId: candidate.showcaseId,
        });
      }
      throw error;
    }
    await recordRepairDispatch({
      claimId: repairAttempt.claimId,
      db: env.DB,
      outcome: "queued",
    });
  }
}

async function markRepairFailure(input: {
  reason: string;
  runId: string;
  showcaseId: string;
}) {
  const now = new Date();
  const [run] = await getDb()
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);
  const failureSummary =
    input.reason === FROZEN_EVALUATION_REPAIR_FAILURE_CODE
      ? FROZEN_EVALUATION_REPAIR_FAILURE_SUMMARY
      : "AI review stopped after the bounded repair retry policy was exhausted.";
  if (run?.status === "scored") {
    await transitionRun({
      id: input.runId,
      from: run.status,
      to: "evaluation_failed",
      patch: {
        failureCode: input.reason,
        failureSummary,
        rankEligible: false,
      },
    });
  } else {
    await getDb()
      .update(runs)
      .set({
        failureCode: input.reason,
        failureSummary,
        rankEligible: false,
        updatedAt: now,
      })
      .where(eq(runs.id, input.runId));
  }
  await getDb()
    .update(showcases)
    .set({
      judgeStatus: "failed",
      rankingStatus: "ineligible",
      updatedAt: now,
    })
    .where(
      and(
        eq(showcases.id, input.showcaseId),
        // Terminalization must land from ANY non-terminal state: frozen or
        // budget-exhausted repairs can fire while the showcase is "scored"
        // (before the sweep ever set "judging"), and schema states like
        // "queued"/"evaluating" must not strand a terminal repair either.
        ne(showcases.judgeStatus, "failed"),
      ),
    );
  await appendAuditEvent({
    actorUserId: null,
    entityType: "run",
    entityId: input.runId,
    action: "run.pipeline_failed",
    metadata: {
      code: input.reason,
      repair: true,
      stage: "judge",
    },
  });
}
