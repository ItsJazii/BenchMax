import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  listPublicDeclaredModels,
  listPublicShowcaseCardsPage,
} from "@/lib/data/showcases";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} Tests` };
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const models = await listPublicDeclaredModels().catch(() => null);
  if (!models) {
    return (
      <div className="site-shell">
        <SiteHeader />
        <main className="inner-page section-wrap">
          <div className="security-gate">Model Tests are temporarily unavailable.</div>
        </main>
        <SiteFooter />
      </div>
    );
  }
  const model = models.find(
    (candidate) => candidate.label.toLowerCase() === slug.toLowerCase(),
  );
  if (!model) notFound();
  const page = await listPublicShowcaseCardsPage({
    limit: 50,
    modelExact: model.label,
  });
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">DECLARED MODEL</span>
            <h1>{model.label}</h1>
          </div>
          <p>Declared by contributors — not independently verified.</p>
        </header>
        <div className="card-grid">
          {page.items.map((test) => (
            <ShowcaseCard key={test.id} showcase={test} />
          ))}
        </div>
        {page.hasNext && (
          <p className="muted">
            Showing the newest 50 Tests. Use the All Tests filters for a narrower view.
          </p>
        )}
        <Link className="text-link" href={`/tests?model=${encodeURIComponent(model.label)}`}>
          Open this model in All Tests →
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
