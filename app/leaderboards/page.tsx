import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicResultLeaderboard } from "@/lib/data/results";

export const metadata: Metadata = {
  title: "Result leaderboards",
  description:
    "AI-judged community model results ranked separately for each frozen test version.",
};

export default async function LeaderboardsPage() {
  const rows = await listPublicResultLeaderboard().catch(() => null);
  const grouped = rows
    ? Map.groupBy(
        rows,
        (row) =>
          `${row.testSlug}:${row.testVersion}:evaluation-${row.evaluationVersion}`,
      )
    : null;
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">AI-JUDGED RESULTS</span>
            <h1>One leaderboard per test.</h1>
          </div>
          <p>
            Results are never merged across different prompts or rubrics.
            Unknown model or harness labels stay public but remain unranked
            until the catalog mapping is reviewed. Model, harness, reasoning,
            and settings are declared, unverified metadata.
          </p>
        </header>
        {rows === null ? (
          <div className="security-gate">
            <strong>Leaderboards are temporarily unavailable.</strong>
            <p>
              Benchmax does not show an empty ranking when the public catalog
              cannot be read.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <strong>No ranked results yet.</strong>
            <p>
              Submitted results still appear publicly while AI review is
              pending. A leaderboard appears after the first eligible score.
            </p>
            <Link className="button button-primary" href="/submit">
              Submit a result
            </Link>
          </div>
        ) : (
          [...grouped!.values()].map((testRows) => {
            const first = testRows[0];
            return (
              <section
                className="leaderboard-section"
                key={`${first.testSlug}:${first.testVersion}`}
              >
                <div className="section-heading compact">
                  <div>
                    <span className="section-index">
                      TEST VERSION {first.testVersion} · SNAPSHOT{" "}
                      {first.snapshotVersion} · EVALUATION V
                      {first.evaluationVersion}
                    </span>
                    <h2>
                      <Link
                        href={`/tests/${first.testSlug}?version=${first.testVersion}`}
                      >
                        {first.testTitle}
                      </Link>
                    </h2>
                  </div>
                  <small>
                    {first.judgeSnapshot} ·{" "}
                    {first.snapshotPublishedAt?.toISOString() ??
                      "Snapshot pending"}
                  </small>
                </div>
                <div className="ranking-board exact-board">
                  <div className="ranking-head">
                    <span>Rank / result</span>
                    <span>Score</span>
                    <span>Judge samples</span>
                    <span>Configuration</span>
                  </div>
                  {testRows.map((row) => (
                    <div className="ranking-row" key={row.resultSlug}>
                      <div className="ranking-category">
                        <span className="rank-number">{row.rank}</span>
                        <div>
                          <strong>
                            <Link href={`/results/${row.resultSlug}`}>
                              {row.resultTitle}
                            </Link>
                          </strong>
                          <div className="mono muted">
                            {row.model} · {row.modelVersion}
                          </div>
                          <small>Declared, unverified</small>
                        </div>
                      </div>
                      <strong className="score-large">
                        {(row.scoreBps / 100).toFixed(2)}
                      </strong>
                      <span className="mono">{row.sampleCount}</span>
                      <span className="mono">
                        {row.harness} · {row.reasoning} · @{row.contributor}
                        <small>Declared, unverified</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
