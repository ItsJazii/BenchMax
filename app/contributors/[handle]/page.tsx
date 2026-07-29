import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { showcaseFeed } from "@/lib/domain/catalog";
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
  const databaseTests = contributor
    ? (await listPublicShowcaseCards(50)).filter(
        (item) => item.contributor === handle,
      )
    : [];
  const tests =
    databaseTests.length > 0
      ? databaseTests
      : showcaseFeed.filter((item) => item.contributor === handle);
  if (tests.length === 0) notFound();

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="profile-header">
          <div className="profile-avatar" aria-hidden="true">
            {handle.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span className="section-index">CONTRIBUTOR</span>
            <h1>@{handle}</h1>
            <p>
              {contributor
                ? `${contributor.displayName} shares inspectable model tests and their evidence.`
                : "Sharing inspectable model tests across code, games, and browser experiences."}
            </p>
          </div>
          <dl>
            <div>
              <dt>Public tests</dt>
              <dd>{tests.length}</dd>
            </div>
            <div>
              <dt>Ranked runs</dt>
              <dd>{contributor?.rankedRunCount ?? 0}</dd>
            </div>
          </dl>
        </header>
        <div className="section-heading compact">
          <div>
            <span className="section-index">PUBLIC RECORD</span>
            <h2>Shared tests</h2>
          </div>
        </div>
        <div className="card-grid">
          {tests.map((test) => (
            <ShowcaseCard key={test.id} showcase={test} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
