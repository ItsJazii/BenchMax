import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicConfigurationSummaries } from "@/lib/data/results";

export const metadata: Metadata = {
  title: "Community model configuration summary",
};

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await listPublicConfigurationSummaries(slug).catch(
    () => null,
  );
  const summaries = result?.summaries ?? [];
  const modelLabel = summaries[0]?.modelLabel ?? slug;
  const snapshotDate = summaries
    .map((summary) => summary.snapshotDate?.getTime())
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => b - a)[0];
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">COMMUNITY MODEL SUMMARY</span>
            <h1>{modelLabel}</h1>
          </div>
          <p>
            Contributor-declared, unverified model, harness, reasoning, and
            settings metadata. This summary is not a verified model ranking.
          </p>
        </header>
        <div className="method-note">
          Each test version contributes one median to the equal-weight score.
          IQR is calculated across those test medians, so popular tests cannot
          dominate the summary.
        </div>
        {summaries.length === 0 ? (
          <div className="empty-state">
            <strong>No eligible configurations for this model yet.</strong>
            <p>
              Pending, delayed, and unranked submissions remain visible in
              Explore even when they cannot enter this summary.
            </p>
            <Link className="button button-primary" href="/explore">
              Browse public results
            </Link>
          </div>
        ) : (
          <div className="ranking-board exact-board">
            <div className="ranking-head">
              <span>Declared configuration</span>
              <span>Equal-test score</span>
              <span>Coverage / N</span>
              <span>IQR</span>
            </div>
            {summaries.map((summary) => (
              <div className="ranking-row" key={summary.configurationId}>
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
                  {summary.testCoverage} tests · {summary.contributorCount}{" "}
                  contributors
                  {summary.provisional ? " · provisional" : ""}
                </span>
                <span className="mono">
                  {(summary.q1ScoreBps / 100).toFixed(2)}–
                  {(summary.q3ScoreBps / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="results-line">
          <span>
            Snapshot date{" "}
            {snapshotDate
              ? new Date(snapshotDate).toISOString()
              : "not available"}
          </span>
          <span className="mono">
            {result
              ? `Evaluation v${result.evaluationVersion ?? "unavailable"} · aggregate snapshot v${result.snapshotVersion ?? "unavailable"} · reproducibility hash ${result.snapshotHash}`
              : "Summary unavailable"}
          </span>
        </div>
        <Link className="text-link" href="/leaderboards">
          Compare results on the primary per-test leaderboards
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
