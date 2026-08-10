import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicDeclaredModels } from "@/lib/data/showcases";

export const metadata: Metadata = {
  title: "Models",
  description: "Browse public Tests by the model declared by each contributor.",
};

export default async function ModelsPage() {
  const result = await listPublicDeclaredModels().catch(() => null);
  const models = result ?? [];
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">MODELS</span>
            <h1>Tests grouped by declared model.</h1>
          </div>
          <p>
            These names come from contributors. They are useful for browsing,
            but Benchmax has not independently verified the model identity.
          </p>
        </header>
        {result === null ? (
          <div className="security-gate">
            <strong>Models are temporarily unavailable.</strong>
            <p>Benchmax will not replace unavailable data with invented entries.</p>
          </div>
        ) : models.length === 0 ? (
          <div className="empty-state">
            <strong>No public Tests yet.</strong>
            <p>Models appear here as soon as a safe Test is published.</p>
            <Link className="button button-primary" href="/submit">
              Submit a Test
            </Link>
          </div>
        ) : (
          <div className="model-detail-grid">
            {models.map((model) => (
              <article key={model.label}>
                <span className="status-pill neutral">
                  {model.testCount} Test{model.testCount === 1 ? "" : "s"}
                </span>
                <h2>
                  <Link href={`/models/${encodeURIComponent(model.label)}`}>
                    {model.label}
                  </Link>
                </h2>
                <p>Declared by contributors — not independently verified.</p>
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
