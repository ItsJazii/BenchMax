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

const models = [
  {
    name: "K3",
    provider: "Kimi",
    tests: 1,
    coverage: ["Browser games"],
    status: "Community evidence",
  },
  {
    name: "Opus 4.6",
    provider: "Anthropic",
    tests: 1,
    coverage: ["Frontend"],
    status: "Platform replayed",
  },
  {
    name: "GPT coding model",
    provider: "OpenAI",
    tests: 1,
    coverage: ["Browser 3D"],
    status: "Community evidence",
  },
];

export default async function ModelsPage() {
  const configurations = await listPublicConfigurations().catch(() => []);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">CANONICAL CATALOG</span>
            <h1>Models are versions, not vibes.</h1>
          </div>
          <p>
            Benchmax keeps provider, endpoint, harness, reasoning, and settings
            distinct so similar names never silently collapse into one score.
          </p>
        </header>
        <div className="model-table">
          <div className="model-table-head">
            <span>Model</span>
            <span>Provider</span>
            <span>Evidence</span>
            <span>Coverage</span>
            <span>Status</span>
          </div>
          {configurations.length > 0
            ? configurations.map((configuration) => (
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
              ))
            : models.map((model) => (
                <div className="model-row" key={model.name}>
                  <strong>{model.name}</strong>
                  <span>{model.provider}</span>
                  <span className="mono">{model.tests} test</span>
                  <span>{model.coverage.join(", ")}</span>
                  <span className="status-pill neutral">{model.status}</span>
                </div>
              ))}
        </div>
        <div className="catalog-note">
          <span>CATALOG POLICY</span>
          <h2>No free-text names in official rankings.</h2>
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
