import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  getPublicContributor,
  listPublicShowcaseCards,
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
  const publicResults = await listPublicShowcaseCards(50).catch(() => null);
  const results = (publicResults ?? []).filter(
    (item) => item.contributor === contributor.handle,
  );

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
              {contributor.displayName} shares inspectable model test results
              and their evidence.
            </p>
          </div>
          <dl>
            <div>
              <dt>Public results</dt>
              <dd>{results.length}</dd>
            </div>
          </dl>
        </header>
        <div className="section-heading compact">
          <div>
            <span className="section-index">PUBLIC RECORD</span>
            <h2>Submitted results</h2>
          </div>
        </div>
        {results.length > 0 ? (
          <div className="card-grid">
            {results.map((result) => (
              <ShowcaseCard key={result.id} showcase={result} />
            ))}
          </div>
        ) : publicResults === null ? (
          <div className="empty-state">
            <strong>Public results are temporarily unavailable.</strong>
            <p>
              Benchmax does not show substitute data when this contributor’s
              public records cannot be read.
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No public results yet.</strong>
            <p>
              This active contributor has not published a model test result.
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
