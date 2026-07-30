import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicConfigurations } from "@/lib/data/public-catalog";

export const metadata: Metadata = {
  title: "Models",
  description:
    "Canonical model and provider configurations tracked by Benchmax.",
};

export default async function ModelsPage() {
  const configurationsResult = await listPublicConfigurations().catch(
    () => null,
  );
  const configurations = configurationsResult ?? [];
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">CANONICAL CATALOG</span>
            <h1>A model name is not a configuration.</h1>
          </div>
          <p>
            Provider, endpoint, model version, harness, reasoning level, and
            settings stay separate so unlike runs never collapse into one
            score.
          </p>
        </header>
        {configurations.length > 0 ? (
          <div className="model-table">
            <div className="model-table-head">
              <span>Model</span>
              <span>Provider</span>
              <span>Evidence</span>
              <span>Coverage</span>
              <span>Status</span>
            </div>
            {configurations.map((configuration) => (
                <div className="model-row" key={configuration.id}>
                  <strong>
                    <Link href={`/models/${configuration.model_slug}`}>
                      {configuration.model_name} ·{" "}
                      {configuration.reasoning_level}
                    </Link>
                  </strong>
                  <span>{configuration.provider_name}</span>
                  <span className="mono">
                    {configuration.published_runs} runs
                  </span>
                  <span>
                    {configuration.harness_name} v
                    {configuration.harness_version}
                  </span>
                  <span className="status-pill approved">
                    {configuration.version_label} ·{" "}
                    {configuration.settings_hash.slice(0, 8)}
                  </span>
                </div>
              ))}
          </div>
        ) : configurationsResult === null ? (
          <div className="empty-state">
            <strong>The model catalog is temporarily unavailable.</strong>
            <p>
              Benchmax does not show placeholder models while approved
              configurations cannot be read.
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No approved model configurations yet.</strong>
            <p>
              Models will appear here only after their provider, endpoint,
              version, harness, reasoning level, and settings hash are recorded.
            </p>
            <Link className="button button-secondary" href="/methodology">
              Read configuration identity
            </Link>
          </div>
        )}
        <div className="catalog-note">
          <span>CATALOG POLICY</span>
          <h2>Official rankings use approved configuration IDs.</h2>
          <p>
            Ranked configurations will reference approved catalog entries with
            resolved model IDs and immutable settings hashes. Uploaded
            showcases can still describe external tools honestly.
          </p>
          <Link href="/compare">Compare exact configurations →</Link>
          <br />
          <Link href="/methodology">Read configuration identity →</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
