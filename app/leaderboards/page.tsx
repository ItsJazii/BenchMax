import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  listAggregateLeaderboard,
  listFrontendLeaderboard,
} from "@/lib/data/leaderboards";

export const metadata: Metadata = {
  title: "Frontend leaderboard",
  description:
    "Exact-configuration frontend benchmark rankings built only from platform-generated runs.",
};

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope: requestedScope } = await searchParams;
  const scope = [
    "frontend",
    "browser-game",
    "browser-3d",
    "overall",
  ].includes(requestedScope ?? "")
    ? (requestedScope as
        | "frontend"
        | "browser-game"
        | "browser-3d"
        | "overall")
    : "frontend";
  const aggregateRows = await listAggregateLeaderboard(scope).catch(() => []);
  const rows = await listFrontendLeaderboard().catch(() => []);
  const grouped = Map.groupBy(rows, (row) => row.benchmarkTitle);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">PLATFORM-GENERATED ONLY</span>
            <h1>Frontend leaderboard.</h1>
          </div>
          <p>
            Every row is an exact model version, provider endpoint, harness,
            reasoning level, and settings hash. N and IQR stay visible.
          </p>
        </header>
        <nav className="filter-bar" aria-label="Leaderboard scope">
          {[
            ["frontend", "Frontend"],
            ["browser-game", "Browser games"],
            ["browser-3d", "Browser 3D"],
            ["overall", "Overall"],
          ].map(([value, label]) => (
            <Link
              aria-current={scope === value ? "page" : undefined}
              href={`/leaderboards?scope=${value}`}
              key={value}
            >
              {label}
            </Link>
          ))}
        </nav>
        {aggregateRows.length > 0 && (
          <section className="leaderboard-section">
            <div className="section-heading compact">
              <div>
                <span className="section-index">
                  EQUAL-WEIGHT AGGREGATE
                </span>
                <h2>
                  {scope === "overall"
                    ? "Overall"
                    : scope === "frontend"
                      ? "Frontend"
                      : scope === "browser-game"
                        ? "Browser games"
                        : "Browser 3D"}
                </h2>
              </div>
            </div>
            <div className="ranking-board exact-board">
              <div className="ranking-head">
                <span>Rank / configuration</span>
                <span>Score</span>
                <span>Coverage</span>
                <span>Status</span>
              </div>
              {aggregateRows.map((row) => (
                <div className="ranking-row" key={row.configuration_id}>
                  <div className="ranking-category">
                    <span className="rank-number">{row.rank}</span>
                    <div>
                      <strong>
                        {row.model_name} · {row.reasoning_level}
                      </strong>
                      <div className="mono muted">
                        {row.provider_name} · {row.harness_name} v
                        {row.harness_version}
                      </div>
                    </div>
                  </div>
                  <strong className="score-large">
                    {(row.score_bps / 100).toFixed(2)}
                  </strong>
                  <span className="mono">
                    {row.benchmark_coverage} benchmarks ·{" "}
                    {row.category_coverage} categories · {row.total_run_count} runs
                  </span>
                  <span
                    className={`status-pill ${
                      row.provisional ? "pending" : "approved"
                    }`}
                  >
                    {row.provisional ? "Provisional" : "Established"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {rows.length === 0 && aggregateRows.length === 0 ? (
          <div className="empty-state">
            <strong>No ranking-eligible runs yet.</strong>
            <p>
              The board remains empty until Benchmax controls generation,
              execution, and scoring end-to-end.
            </p>
            <Link className="button button-primary" href="/run">
              Launch a benchmark run
            </Link>
          </div>
        ) : scope === "frontend" ? (
          [...grouped.entries()].map(([benchmark, benchmarkRows]) => (
            <section className="leaderboard-section" key={benchmark}>
              <div className="section-heading compact">
                <div>
                  <span className="section-index">
                    FROZEN BENCHMARK VERSION
                  </span>
                  <h2>{benchmark}</h2>
                </div>
              </div>
              <div className="ranking-board exact-board">
                <div className="ranking-head">
                  <span>Rank / configuration</span>
                  <span>Median</span>
                  <span>N · IQR</span>
                  <span>Status</span>
                </div>
                {benchmarkRows.map((row) => (
                  <div className="ranking-row" key={row.configurationId}>
                    <div className="ranking-category">
                      <span className="rank-number">{row.rank}</span>
                      <div>
                        <strong>
                          {row.modelName} · {row.reasoningLevel}
                        </strong>
                        <div className="mono muted">
                          {row.providerName} / {row.endpointName} ·{" "}
                          {row.harnessName} v{row.harnessVersion}
                        </div>
                        <div className="hash-line">
                          settings {row.settingsHash.slice(0, 12)}…
                        </div>
                      </div>
                    </div>
                    <strong className="score-large">
                      {(row.medianScoreBps / 100).toFixed(2)}
                    </strong>
                    <span className="mono">
                      {row.runCount} · {(row.q1ScoreBps / 100).toFixed(1)}–
                      {(row.q3ScoreBps / 100).toFixed(1)}
                    </span>
                    <span
                      className={`status-pill ${
                        row.provisional ? "pending" : "approved"
                      }`}
                    >
                      {row.provisional ? "Provisional" : "Established"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
