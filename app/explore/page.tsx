import type { Metadata } from "next";
import Link from "next/link";
import { categoryLabels } from "@/lib/domain/catalog";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { RunCard } from "@/app/components/RunCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicShowcaseCards } from "@/lib/data/showcases";
import { listRecentPublicRuns } from "@/lib/data/runs";

export const metadata: Metadata = {
  title: "Explore model tests",
  description:
    "Browse community AI model tests by category, model, harness, and trust label.",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{
    benchmark?: string;
    category?: string;
    contributor?: string;
    date?: string;
    model?: string;
    q?: string;
    reasoning?: string;
    trust?: string;
  }>;
}) {
  const filters = await searchParams;
  const [databaseFeedResult, publicRunsResult] = await Promise.all([
    listPublicShowcaseCards(50).catch(() => null),
    listRecentPublicRuns(100).catch(() => null),
  ]);
  const databaseFeed = databaseFeedResult ?? [];
  const publicRuns = publicRunsResult ?? [];
  const recordsUnavailable =
    databaseFeedResult === null || publicRunsResult === null;
  const hasFilters = Object.values(filters).some((value) => value?.trim());
  const query = filters.q?.trim().toLowerCase() ?? "";
  const model = filters.model?.trim().toLowerCase() ?? "";
  const benchmark = filters.benchmark?.trim().toLowerCase() ?? "";
  const contributor = filters.contributor?.trim().toLowerCase() ?? "";
  const since = filters.date ? Date.parse(`${filters.date}T00:00:00Z`) : NaN;
  const showcaseResults = databaseFeed.filter((item) => {
    const categoryMatch =
      !filters.category || filters.category === item.category;
    const trustMatch =
      !filters.trust ||
      item.trust.toLowerCase().includes(filters.trust.toLowerCase());
    const queryMatch =
      !query ||
      [item.title, item.model, item.harness, item.contributor]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return (
      categoryMatch &&
      trustMatch &&
      queryMatch &&
      (!model || item.model.toLowerCase().includes(model)) &&
      !benchmark &&
      (!filters.reasoning ||
        item.reasoning.toLowerCase() === filters.reasoning.toLowerCase()) &&
      (!contributor ||
        item.contributor.toLowerCase().includes(contributor)) &&
      (!Number.isFinite(since) ||
        (Number.isFinite(Date.parse(item.published)) &&
          Date.parse(item.published) >= since))
    );
  });
  const runResults = publicRuns.filter((run) => {
    const queryMatch =
      !query ||
      [
        run.model,
        run.benchmark,
        run.harness,
        run.contributorHandle,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return (
      (!filters.category || filters.category === run.category) &&
      (!filters.trust || filters.trust === "generated") &&
      queryMatch &&
      (!model || run.model.toLowerCase().includes(model)) &&
      (!benchmark || run.benchmark.toLowerCase().includes(benchmark)) &&
      (!filters.reasoning ||
        run.reasoningLevel.toLowerCase() ===
          filters.reasoning.toLowerCase()) &&
      (!contributor ||
        run.contributorHandle.toLowerCase().includes(contributor)) &&
      (!Number.isFinite(since) ||
        Boolean(run.publishedAt && run.publishedAt.getTime() >= since))
    );
  });
  const resultCount = showcaseResults.length + runResults.length;

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLIC TEST RECORD</span>
          <h1>Browse real model tests.</h1>
          <p>
            Search by model, harness, benchmark, reasoning level, or
            contributor. Community uploads stay clearly labeled and never
            affect rankings.
          </p>
        </header>

        <form className="filter-bar" action="/explore" method="get">
          <label>
            <span>Search</span>
            <input
              defaultValue={filters.q}
              name="q"
              placeholder="Model, harness, contributor..."
              type="search"
            />
          </label>
          <label>
            <span>Model</span>
            <input
              defaultValue={filters.model}
              name="model"
              placeholder="K3..."
            />
          </label>
          <label>
            <span>Benchmark</span>
            <input
              defaultValue={filters.benchmark}
              name="benchmark"
              placeholder="Responsive..."
            />
          </label>
          <label>
            <span>Reasoning</span>
            <select defaultValue={filters.reasoning ?? ""} name="reasoning">
              <option value="">All levels</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </label>
          <label>
            <span>Contributor</span>
            <input
              defaultValue={filters.contributor}
              name="contributor"
              placeholder="Handle"
            />
          </label>
          <label>
            <span>Published since</span>
            <input defaultValue={filters.date} name="date" type="date" />
          </label>
          <label>
            <span>Category</span>
            <select defaultValue={filters.category ?? ""} name="category">
              <option value="">All categories</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Trust label</span>
            <select defaultValue={filters.trust ?? ""} name="trust">
              <option value="">All labels</option>
              <option value="community">Community showcase</option>
              <option value="replayed">Platform replayed</option>
              <option value="generated">Platform generated</option>
            </select>
          </label>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
        </form>

        <div className="results-line">
          <span>
            {resultCount} {recordsUnavailable ? "visible tests" : "tests"}
          </span>
          <span>{recordsUnavailable ? "Some records unavailable" : "Newest first"}</span>
        </div>

        {resultCount > 0 ? (
          <>
            {runResults.length > 0 && (
              <section className="explore-track">
                <span className="section-index">PLATFORM GENERATED</span>
                <div className="card-grid">
                  {runResults.map((run) => (
                    <RunCard key={run.id} run={run} />
                  ))}
                </div>
              </section>
            )}
            {showcaseResults.length > 0 && (
              <section className="explore-track">
                <span className="section-index">
                  COMMUNITY TESTS · NOT RANKED
                </span>
                <div className="card-grid">
                  {showcaseResults.map((showcase) => (
                    <ShowcaseCard key={showcase.id} showcase={showcase} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="empty-state">
            <strong>
              {recordsUnavailable
                ? "Public test records are temporarily unavailable."
                : hasFilters
                ? "No tests match those filters."
                : "No public tests have been published yet."}
            </strong>
            <p>
              {recordsUnavailable
                ? "Benchmax does not show sample submissions when the public catalog cannot be read."
                : hasFilters
                ? "Clear the filters or put a new test on the record."
                : "Approved community uploads and completed platform runs will appear here."}
            </p>
            <div>
              {!recordsUnavailable && hasFilters && (
                <Link className="button button-secondary" href="/explore">
                  Clear filters
                </Link>
              )}
              {!recordsUnavailable && (
                <Link className="button button-primary" href="/upload">
                  {hasFilters ? "Upload a test" : "Upload the first test"}
                </Link>
              )}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
