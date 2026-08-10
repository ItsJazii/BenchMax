import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  getPublicContributor,
  listPublicShowcaseCardsPage,
} from "@/lib/data/showcases";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle}` };
}

export default async function ContributorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const contributor = await getPublicContributor(handle).catch(() => null);
  if (!contributor) notFound();
  const publicResultsPage = await listPublicShowcaseCardsPage({
    contributor: contributor.handle,
    limit: 50,
  }).catch(() => null);
  const results = publicResultsPage?.items ?? [];

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="profile-header">
          <div className="profile-avatar" aria-hidden="true">
            {contributor.handle.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span className="section-index">CONTRIBUTOR</span>
            <h1>@{contributor.handle}</h1>
            <p>
              {contributor.displayName} shares public AI Tests with inspectable
              prompts, declared setup, and evidence.
            </p>
          </div>
          <dl>
            <div>
              <dt>Public Tests</dt>
              <dd>{results.length}</dd>
            </div>
          </dl>
        </header>
        <div className="section-heading compact">
          <div>
            <span className="section-index">PUBLIC RECORD</span>
            <h2>Submitted Tests</h2>
          </div>
        </div>
        {results.length > 0 ? (
          <div className="card-grid">
            {results.map((result) => (
              <ShowcaseCard key={result.id} showcase={result} />
            ))}
          </div>
        ) : publicResultsPage === null ? (
          <div className="empty-state">
            <strong>Public Tests are temporarily unavailable.</strong>
            <p>
              Benchmax does not show substitute data when this contributor’s
              public records cannot be read.
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No public Tests yet.</strong>
            <p>This contributor has not published a Test.</p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
