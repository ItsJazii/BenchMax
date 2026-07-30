import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { TrustBadge } from "@/app/components/TrustBadge";
import { categoryLabels } from "@/lib/domain/catalog";
import { getPublicShowcaseBySlug } from "@/lib/data/showcases";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const showcase = await getPublicShowcaseBySlug(slug).catch(() => null);
  return {
    title: showcase?.title ?? "Test report",
    description: showcase?.summary,
  };
}

export default async function ShowcasePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const databaseShowcase = await getPublicShowcaseBySlug(slug).catch(() => null);
  if (!databaseShowcase) notFound();
  const showcase = {
    ...databaseShowcase,
    description: databaseShowcase.summary,
    evidence: databaseShowcase.artifacts.map(
      (artifact) =>
        artifact.kind.charAt(0).toUpperCase() + artifact.kind.slice(1),
    ),
    published:
      databaseShowcase.publishedAt?.toISOString() ??
      "Publication time unavailable",
    trust: "Community Showcase" as const,
  };

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="showcase-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/explore">Explore</Link>
          <span>/</span>
          <span>{categoryLabels[showcase.category]}</span>
        </div>
        <header className="showcase-hero">
          <div>
            <TrustBadge trust={showcase.trust} />
            <h1>{showcase.title}</h1>
            <p>{showcase.description}</p>
            <div className="showcase-byline">
              <Link href={`/contributors/${showcase.contributor}`}>
                @{showcase.contributor}
              </Link>
              <span>{showcase.published}</span>
              <span>Approved public record</span>
            </div>
          </div>
          <div className="showcase-spec">
            <div>
              <span>MODEL</span>
              <strong>{showcase.model}</strong>
            </div>
            <div>
              <span>HARNESS</span>
              <strong>{showcase.harness}</strong>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{showcase.reasoning}</strong>
            </div>
            <div>
              <span>CATEGORY</span>
              <strong>{categoryLabels[showcase.category]}</strong>
            </div>
          </div>
        </header>

        <section className="evidence-stage">
          <div className={`evidence-preview preview-${showcase.category}`}>
            <div className="preview-toolbar">
              <span>OUTPUT PREVIEW</span>
              <span>SAFE STATIC CAPTURE</span>
            </div>
            <div className="preview-canvas">
              <div className="preview-orbit" />
              <div className="preview-window-card">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
          <aside>
            <span className="section-index">EVIDENCE INCLUDED</span>
            {showcase.evidence.map((item, index) => (
              <div className="evidence-row" key={item}>
                <span>0{index + 1}</span>
                <strong>{item}</strong>
                <span className="status-pill neutral">Recorded</span>
              </div>
            ))}
            <div className="safety-callout">
              <strong>Why no live embed?</strong>
              <p>
                M1 never executes community uploads on the main domain. Playable
                output arrives with the isolated user-content origin.
              </p>
            </div>
          </aside>
        </section>

        <section className="test-context">
          <div>
            <span className="section-index">TEST CONTEXT</span>
            <h2>The claim is inspectable.</h2>
          </div>
          <div className="context-grid">
            <article>
              <span>PROMPT</span>
              <p>{databaseShowcase.prompt}</p>
            </article>
            <article>
              <span>SOURCE</span>
              <p>
                {databaseShowcase.sourceVisibility === "public"
                  ? "The contributor selected public source visibility."
                  : "The contributor kept source private; source bytes and object keys are not exposed."}
              </p>
            </article>
            <article>
              <span>RANKING IMPACT</span>
              <p>
                None. This is a showcase, not a platform-generated Benchmark
                Run.
              </p>
            </article>
          </div>
        </section>
        <section className="closing-cta">
          <p>Want a claim that can enter the leaderboard?</p>
          <h2>Fund a platform-generated run of this configuration.</h2>
          <Link
            className="button button-primary"
            href={`/run?fromShowcase=${encodeURIComponent(showcase.id)}`}
          >
            Promote to a verified run
          </Link>
        </section>
        <div className="report-link">
          <Link
            href={`/report?target=${encodeURIComponent(`/showcases/${showcase.slug}`)}`}
          >
            Report this showcase →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
