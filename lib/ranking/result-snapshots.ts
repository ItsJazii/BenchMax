import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  judgeSamples,
  resultLeaderboardEntries,
  resultLeaderboardSnapshots,
  runs,
  showcases,
} from "@/db/schema";
import { canonicalSha256 } from "@/lib/security/canonical";
import { rankResultRows } from "@/lib/ranking/result-ranking";

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
        eq(showcases.rankingStatus, "eligible"),
      ),
    )
    .groupBy(runs.id, showcases.id)
    .orderBy(desc(runs.overallScoreBps), runs.id);
  const ranked = rankResultRows(rows);
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
      ),
    )
    .limit(1);
  if (existing) {
    await enqueueTopTenEscalations(ranked);
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
  const now = new Date();
  const snapshotId = crypto.randomUUID();
  await getDb().insert(resultLeaderboardSnapshots).values({
    id: snapshotId,
    benchmarkVersionId: input.benchmarkVersionId,
    evaluationVersionId: input.evaluationVersionId,
    version: (latest?.version ?? 0) + 1,
    resultSetHash,
    status: "building",
    publishedAt: null,
    createdAt: now,
  });
  for (const row of ranked) {
    await getDb().insert(resultLeaderboardEntries).values({
      id: crypto.randomUUID(),
      snapshotId,
      showcaseId: row.showcaseId,
      runId: row.runId,
      rank: row.rank,
      scoreBps: row.scoreBps,
      sampleCount: row.sampleCount,
      createdAt: now,
    });
  }
  await getDb()
    .update(resultLeaderboardSnapshots)
    .set({ status: "superseded" })
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
        eq(resultLeaderboardSnapshots.status, "published"),
      ),
    );
  const [published] = await getDb()
    .update(resultLeaderboardSnapshots)
    .set({ status: "published", publishedAt: now })
    .where(eq(resultLeaderboardSnapshots.id, snapshotId))
    .returning();
  await enqueueTopTenEscalations(ranked);
  return published;
}

async function enqueueTopTenEscalations(
  ranked: Array<{
    rank: number;
    runId: string;
    sampleCount: number;
    showcaseId: string;
  }>,
) {
  const candidates = ranked.filter(
    (row) => row.rank <= 10 && row.sampleCount < 3,
  );
  if (candidates.length === 0) return;
  const { env } = await import("cloudflare:workers");
  for (const candidate of candidates) {
    await getDb()
      .update(showcases)
      .set({ judgeStatus: "judging", updatedAt: new Date() })
      .where(eq(showcases.id, candidate.showcaseId));
    await env.JUDGE_QUEUE.send({
      runId: candidate.runId,
      stage: "judge",
      stageVersion: "escalation-k3-v1",
    });
  }
}
