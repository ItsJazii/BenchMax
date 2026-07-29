import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { getPublicBenchmarkPage } from "@/lib/data/public-catalog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicBenchmarkPage(slug).catch(() => null);
  return { title: data?.benchmark.title ?? "Benchmark" };
}

export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicBenchmarkPage(slug).catch(() => null);
  if (!data) notFound();
  const current = data.versions[0];
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">{data.benchmark.category}</span>
          <h1>{data.benchmark.title}</h1>
          <p>
            Version {String(current?.version ?? "—")} ·{" "}
            {String(current?.attempt_policy ?? "pass@1")} ·{" "}
            {String(current?.harness_name ?? "Frozen harness")}
          </p>
        </header>
        {current && (
          <section className="run-evidence">
            <div>
              <span className="section-index">CANONICAL PROMPT</span>
              <pre>{String(current.canonical_prompt)}</pre>
            </div>
            <div>
              <span className="section-index">CONTRACT HASHES</span>
              <dl className="provenance-list">
                <div>
                  <dt>Environment</dt>
                  <dd>{String(current.environment_hash)}</dd>
                </div>
                <div>
                  <dt>Harness</dt>
                  <dd>{String(current.contract_hash)}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}
        <section className="model-detail-grid">
          {data.dimensions
            .filter(
              (dimension) =>
                String(dimension.benchmark_version_id) === String(current?.id),
            )
            .map((dimension) => (
              <article key={String(dimension.key)}>
                <span className="status-pill neutral">
                  {String(dimension.mechanism)}
                </span>
                <h2>{String(dimension.title)}</h2>
                <p>{String(dimension.description)}</p>
                <strong>{Number(dimension.weight_bps) / 100}%</strong>
              </article>
            ))}
        </section>
        <section className="history-table">
          <div className="section-heading compact">
            <div>
              <span className="section-index">VERSION HISTORY</span>
              <h2>Contracts never mutate in place</h2>
            </div>
          </div>
          {data.versions.map((version) => (
            <div key={String(version.id)}>
              <strong>Version {String(version.version)}</strong>
              <span>{String(version.attempt_policy)}</span>
              <span>
                {version.published_at
                  ? new Date(Number(version.published_at)).toISOString()
                  : "Draft"}
              </span>
              <span className="mono">
                {String(version.environment_hash).slice(0, 18)}…
              </span>
            </div>
          ))}
        </section>
        <section className="leaderboard-section">
          <div className="section-heading compact">
            <div>
              <span className="section-index">COMPARABLE RUNS</span>
              <h2>Published exact-configuration results</h2>
            </div>
          </div>
          {data.results.length > 0 ? (
            <div className="ranking-board exact-board">
              <div className="ranking-head">
                <span>Rank / configuration</span>
                <span>Median</span>
                <span>N · IQR</span>
                <span>Status</span>
              </div>
              {data.results.map((result, index) => (
                <div
                  className="ranking-row"
                  key={`${String(result.benchmark_version)}-${String(result.settings_hash)}-${index}`}
                >
                  <div className="ranking-category">
                    <span className="rank-number">{String(result.rank)}</span>
                    <div>
                      <strong>
                        {String(result.model_name)} ·{" "}
                        {String(result.reasoning_level)}
                      </strong>
                      <div className="hash-line">
                        settings {String(result.settings_hash).slice(0, 12)}…
                      </div>
                    </div>
                  </div>
                  <strong className="score-large">
                    {(Number(result.median_score_bps) / 100).toFixed(2)}
                  </strong>
                  <span className="mono">
                    {String(result.run_count)} ·{" "}
                    {(Number(result.q1_score_bps) / 100).toFixed(1)}–
                    {(Number(result.q3_score_bps) / 100).toFixed(1)}
                  </span>
                  <span
                    className={`status-pill ${
                      result.provisional ? "pending" : "approved"
                    }`}
                  >
                    {result.provisional ? "Provisional" : "Established"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No comparable published runs yet.</p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
