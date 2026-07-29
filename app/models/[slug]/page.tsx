import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { getPublicModelPage } from "@/lib/data/public-catalog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicModelPage(slug).catch(() => null);
  return { title: data?.model.name ?? "Model" };
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicModelPage(slug).catch(() => null);
  if (!data) notFound();
  const bestByScope = new Map<
    string,
    (typeof data.aggregateResults)[number]
  >();
  for (const result of data.aggregateResults) {
    const scope = String(result.scope);
    if (!bestByScope.has(scope)) bestByScope.set(scope, result);
  }
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">{data.model.provider_name}</span>
          <h1>{data.model.name}</h1>
          <p>
            Exact configurations stay separate. The best-known configuration
            is a labeled maximum over tested settings, never the default
            leaderboard identity.
          </p>
        </header>
        <section className="catalog-note">
          <span>BEST TESTED CONFIGURATION SUMMARY</span>
          <h2>Maximum over tested configurations</h2>
          <p>
            This summary is a convenience view only. Official leaderboard rows
            remain exact configurations because models with more tested
            settings otherwise receive a multiple-comparisons advantage.
          </p>
          <div className="model-best-grid">
            {[...bestByScope.entries()].map(([scope, result]) => (
              <article key={scope}>
                <span>{scope}</span>
                <strong>
                  {(Number(result.score_bps) / 100).toFixed(2)}
                </strong>
                <small>
                  {String(result.reasoning_level)} ·{" "}
                  {String(result.total_run_count)} runs ·{" "}
                  {result.provisional ? "provisional" : "established"}
                </small>
              </article>
            ))}
            {bestByScope.size === 0 && (
              <p className="muted">No published aggregate snapshots yet.</p>
            )}
          </div>
        </section>
        <section className="model-detail-grid">
          {data.configurations.map((configuration) => (
            <article key={String(configuration.id)}>
              <span className="status-pill approved">
                {String(configuration.reasoning_level)}
              </span>
              <h2>{String(configuration.version_label)}</h2>
              <p>
                {String(configuration.endpoint_name)} ·{" "}
                {String(configuration.harness_name)} v
                {String(configuration.harness_version)}
              </p>
              <code>{String(configuration.settings_hash)}</code>
            </article>
          ))}
        </section>
        <section className="history-table">
          <div className="section-heading compact">
            <h2>Score history</h2>
          </div>
          {data.history.map((entry, index) => (
            <div key={`${String(entry.configuration_id)}-${String(entry.snapshot_version)}-${index}`}>
              <strong>{String(entry.benchmark_title)}</strong>
              <span>v{String(entry.benchmark_version)}</span>
              <span>{(Number(entry.median_score_bps) / 100).toFixed(2)}</span>
              <span className="mono">
                N {String(entry.run_count)} ·{" "}
                {(Number(entry.q1_score_bps) / 100).toFixed(1)}–
                {(Number(entry.q3_score_bps) / 100).toFixed(1)}
              </span>
              <time>
                {new Date(Number(entry.published_at)).toISOString()}
              </time>
            </div>
          ))}
          {data.history.length === 0 && (
            <p className="muted">No published snapshots yet.</p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
