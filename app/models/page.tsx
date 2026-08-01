import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicConfigurationSummaries } from "@/lib/data/results";

export const metadata: Metadata = {
  title: "Community model summaries",
  description:
    "Community-declared model configuration summaries derived from immutable per-test leaderboards.",
};

export default async function ModelsPage() {
  const result = await listPublicConfigurationSummaries().catch(() => null);
  const summaries = result?.summaries ?? [];
  const byModel = Map.groupBy(summaries, (summary) => summary.modelSlug);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">COMMUNITY SUMMARIES</span>
            <h1>A model name is not a configuration.</h1>
          </div>
          <p>
            These use declared, unverified model, harness, reasoning, and
            settings metadata. Per-test leaderboards remain the primary
            comparison.
          </p>
        </header>
        {result === null ? (
          <div className="security-gate">
            <strong>Model summaries are temporarily unavailable.</strong>
            <p>
              Benchmax does not replace an unavailable catalog with fabricated
              model or score data.
            </p>
          </div>
        ) : summaries.length === 0 ? (
          <div className="empty-state">
            <strong>No eligible configuration summaries yet.</strong>
            <p>
              Public results appear here after they are scored, catalog-mapped,
              and eligible on at least one test leaderboard.
            </p>
            <Link className="button button-primary" href="/leaderboards">
              View test leaderboards
            </Link>
          </div>
        ) : (
          [...byModel.entries()]
            .sort(([, a], [, b]) =>
              a[0].modelLabel.localeCompare(b[0].modelLabel),
            )
            .map(([modelSlug, modelSummaries]) => (
              <section className="leaderboard-section" key={modelSlug}>
                <div className="section-heading compact">
                  <div>
                    <span className="section-index">
                      {modelSummaries.length} DECLARED CONFIGURATION
                      {modelSummaries.length === 1 ? "" : "S"}
                    </span>
                    <h2>
                      <Link href={`/models/${modelSlug}`}>
                        {modelSummaries[0].modelLabel}
                      </Link>
                    </h2>
                  </div>
                  <small>Declared, unverified metadata</small>
                </div>
                <div className="ranking-board exact-board">
                  <div className="ranking-head">
                    <span>Configuration</span>
                    <span>Equal-test score</span>
                    <span>Tests / contributors</span>
                    <span>IQR</span>
                  </div>
                  {modelSummaries.map((summary) => (
                    <div
                      className="ranking-row"
                      key={summary.configurationId}
                    >
                      <div>
                        <strong>{summary.modelVersionLabel}</strong>
                        <div className="mono muted">
                          {summary.harnessLabel} · {summary.reasoning} reasoning
                        </div>
                        <div className="mono muted">
                          Settings {JSON.stringify(summary.declaredSettings)} · config{" "}
                          {summary.metadataHash.slice(0, 12)}
                        </div>
                        <small>Declared, unverified</small>
                      </div>
                      <strong className="score-large">
                        {(summary.scoreBps / 100).toFixed(2)}
                      </strong>
                      <span className="mono">
                        {summary.testCoverage} / {summary.contributorCount}
                        {summary.provisional ? " · provisional" : ""}
                      </span>
                      <span className="mono">
                        {(summary.q1ScoreBps / 100).toFixed(2)}–
                        {(summary.q3ScoreBps / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))
        )}
        {result && (
          <p className="mono muted">
            Evaluation v{result.evaluationVersion ?? "unavailable"} · aggregate
            snapshot v{result.snapshotVersion ?? "unavailable"} · reproducible
            summary {result.snapshotHash.slice(0, 16)} derived from immutable
            per-test snapshots.
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
