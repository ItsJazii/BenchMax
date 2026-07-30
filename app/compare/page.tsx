import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  comparePublicConfigurations,
  listPublicConfigurations,
} from "@/lib/data/public-catalog";

export const metadata: Metadata = {
  title: "Compare configurations",
  description:
    "Compare exact model, endpoint, harness, reasoning, and settings identities.",
};

const scopes = ["frontend", "browser-game", "browser-3d", "overall"] as const;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ configurations?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = (
    Array.isArray(params.configurations)
      ? params.configurations
      : params.configurations
        ? [params.configurations]
        : []
  );
  const selected = requested.slice(0, 4);
  const [catalog, rows] = await Promise.all([
    listPublicConfigurations().catch(() => []),
    comparePublicConfigurations(selected).catch(() => []),
  ]);
  const grouped = Map.groupBy(rows, (row) => String(row.configuration_id));

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">EXACT CONFIGURATION IDENTITY</span>
            <h1>Compare like with like.</h1>
          </div>
          <p>
            Pick up to four catalog entries. Model version, endpoint, harness,
            reasoning level, and settings hash remain visible beside every
            aggregate.
          </p>
        </header>

        <form className="compare-picker" method="get">
          <fieldset>
            <legend>Select configurations</legend>
            {catalog.map((configuration) => (
              <label key={configuration.id}>
                <input
                  defaultChecked={selected.includes(configuration.id)}
                  name="configurations"
                  type="checkbox"
                  value={configuration.id}
                />
                <span>
                  <strong>
                    {configuration.model_name} ·{" "}
                    {configuration.reasoning_level}
                  </strong>
                  <small>
                    {configuration.provider_name} /{" "}
                    {configuration.endpoint_name} ·{" "}
                    {configuration.harness_name} v
                    {configuration.harness_version}
                  </small>
                </span>
              </label>
            ))}
            {catalog.length === 0 && (
              <p className="muted">
                The canonical catalog has not been seeded in this environment.
              </p>
            )}
          </fieldset>
          <button className="button button-primary" type="submit">
            Compare selected
          </button>
        </form>

        {requested.length > 4 && (
          <p className="form-error" role="alert">
            Only the first four configurations are compared.
          </p>
        )}

        {grouped.size > 0 ? (
          <section className="comparison-grid" aria-label="Comparison results">
            {[...grouped.entries()].map(([configurationId, entries]) => {
              const identity = entries[0];
              const byScope = new Map(
                entries
                  .filter((entry) => entry.scope)
                  .map((entry) => [String(entry.scope), entry]),
              );
              return (
                <article key={configurationId}>
                  <span className="status-pill neutral">
                    {String(identity.provider_name)}
                  </span>
                  <h2>
                    {String(identity.model_name)} ·{" "}
                    {String(identity.reasoning_level)}
                  </h2>
                  <p>
                    {String(identity.version_label)} /{" "}
                    {String(identity.endpoint_name)}
                  </p>
                  <dl className="provenance-list">
                    <div>
                      <dt>Harness</dt>
                      <dd>
                        {String(identity.harness_name)} v
                        {String(identity.harness_version)}
                      </dd>
                    </div>
                    <div>
                      <dt>Settings</dt>
                      <dd>{String(identity.settings_hash)}</dd>
                    </div>
                    {scopes.map((scope) => {
                      const entry = byScope.get(scope);
                      return (
                        <div key={scope}>
                          <dt>{scope}</dt>
                          <dd>
                            {entry
                              ? `${(Number(entry.score_bps) / 100).toFixed(2)} · ${String(entry.total_run_count)} runs${entry.provisional ? " · provisional" : ""}`
                              : "No published aggregate"}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="empty-state">
            <strong>Select configurations to compare.</strong>
            <p>
              Community tests never appear here. This page reads only
              platform-generated, published aggregate snapshots.
            </p>
            <Link className="text-link" href="/methodology">
              Read the ranking protocol →
            </Link>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
