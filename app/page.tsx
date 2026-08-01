import Link from "next/link";
import { ShowcaseCard } from "./components/ShowcaseCard";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { listPublicShowcaseCards } from "@/lib/data/showcases";
import { listPublicResultLeaderboard } from "@/lib/data/results";
import { listCommunityTests } from "@/lib/data/community-tests";

export default async function Home() {
  const [resultsResult, leaderboardRows, tests] = await Promise.all([
    listPublicShowcaseCards(6).catch(() => null),
    listPublicResultLeaderboard().catch(() => []),
    listCommunityTests().catch(() => []),
  ]);
  const results = resultsResult ?? [];
  const latest = results[0];
  return (
    <div className="site-shell">
      <SiteHeader />
      <main>
        <section className="hero section-wrap">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" aria-hidden="true" />
              Community model results, judged in public
            </div>
            <h1>
              Share what a model
              <br />
              <span>actually produced.</span>
            </h1>
            <p className="hero-intro">
              Submit code, images, videos, or logs from a real model test.
              Record the model version, reasoning level, and harness. Your
              result appears after safety checks; AI judging can take up to 24
              hours.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/submit">
                Submit a result <span aria-hidden="true">→</span>
              </Link>
              <Link className="button button-secondary" href="/tests">
                Add a test
              </Link>
            </div>
            <div className="hero-proof" aria-label="Benchmax principles">
              <span>Visible before ranking</span>
              <span>Exact test context</span>
              <span>AI-judged evidence</span>
            </div>
          </div>
          <aside className="hero-panel" aria-label="Latest result">
            <div className="panel-topline">
              <span>LATEST PUBLIC RESULT</span>
              <span>{latest?.status ?? "AWAITING FIRST RESULT"}</span>
            </div>
            {latest && (
              <span className="trust-badge community">{latest.trust}</span>
            )}
            <div className="hero-record">
              <span className="section-index">{latest?.model ?? "PUBLIC EVIDENCE"}</span>
              <strong>{latest?.title ?? "No result has been submitted yet."}</strong>
              <p>
                {latest?.description ??
                  "The first safe result will appear here immediately, even while AI review is pending."}
              </p>
            </div>
            <div className="panel-result">
              <div>
                <span className="result-label">HARNESS</span>
                <strong>{latest?.harness ?? "—"}</strong>
                {latest && <small>{latest.trust}</small>}
              </div>
              <div>
                <span className="result-label">REASONING</span>
                <strong>{latest?.reasoning ?? "—"}</strong>
                {latest && <small>{latest.trust}</small>}
              </div>
              <div>
                <span className="result-label">SCORE</span>
                <strong>
                  {latest?.scoreBps === null || latest?.scoreBps === undefined
                    ? "Pending"
                    : (latest.scoreBps / 100).toFixed(2)}
                </strong>
              </div>
            </div>
          </aside>
        </section>

        <section className="rankings section-wrap">
          <div className="section-heading">
            <div>
              <span className="section-index">01 / HOW IT WORKS</span>
              <h2>Publish first. Judge carefully.</h2>
            </div>
            <p>
              Ranking is a later state, not the admission ticket to the site.
            </p>
          </div>
          <div className="ranking-board">
            {[
              ["1", "Choose or add a test", "Freeze the prompt and success criteria."],
              ["2", "Submit the result", "Attach code, images, video, or logs plus exact settings."],
              ["3", "Appear publicly", "The safe result is visible with pending AI review status."],
              ["4", "AI judge and rank", "Eligible scores enter that test version’s leaderboard."],
            ].map(([number, title, description]) => (
              <div className="ranking-row" key={number}>
                <span className="rank-number">{number}</span>
                <strong>{title}</strong>
                <span>{description}</span>
                <span className="status-pill neutral">
                  {number === "4" ? "Up to 24h" : "Recorded"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="latest section-wrap">
          <div className="section-heading compact">
            <div>
              <span className="section-index">02 / PUBLIC RESULTS</span>
              <h2>Ranked or not, the evidence stays visible.</h2>
            </div>
            <Link className="text-link" href="/explore">
              Explore all results →
            </Link>
          </div>
          {results.length > 0 ? (
            <div className="card-grid">
              {results.map((result) => (
                <ShowcaseCard key={result.id} showcase={result} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>
                {resultsResult === null
                  ? "Public results are temporarily unavailable."
                  : "No public results yet."}
              </strong>
              <p>No sample records are shown in place of real submissions.</p>
              {resultsResult !== null && (
                <Link className="button button-primary" href="/submit">
                  Submit the first result
                </Link>
              )}
            </div>
          )}
        </section>

        <section className="protocol section-wrap">
          <div className="protocol-card">
            <div className="protocol-copy">
              <span className="section-index">03 / LIVE CATALOG</span>
              <h2>Tests and rankings grow with the community.</h2>
              <p>
                {tests.length} published test{tests.length === 1 ? "" : "s"} and{" "}
                {leaderboardRows.length} ranked result
                {leaderboardRows.length === 1 ? "" : "s"} are currently on the
                record.
              </p>
            </div>
            <div className="hero-actions">
              <Link className="button button-secondary" href="/tests">
                Browse tests
              </Link>
              <Link className="button button-primary" href="/leaderboards">
                Open leaderboards
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
