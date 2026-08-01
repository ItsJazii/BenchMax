import type { Metadata } from "next";
import Link from "next/link";
import { categoryLabels } from "@/lib/domain/catalog";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicShowcaseCardsPage } from "@/lib/data/showcases";

const PAGE_SIZE = 24;

type ExploreFilters = {
  category?: string;
  contributor?: string;
  model?: string;
  page?: string;
  q?: string;
  reasoning?: string;
  status?: string;
};

export const metadata: Metadata = {
  title: "Explore model results",
  description:
    "Browse public community model test results, including those still pending AI review.",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<ExploreFilters>;
}) {
  const filters = await searchParams;
  const page = parsePage(filters.page);
  const feedResult = await listPublicShowcaseCardsPage({
    category: filters.category,
    contributor: filters.contributor,
    limit: PAGE_SIZE,
    model: filters.model,
    offset: (page - 1) * PAGE_SIZE,
    q: filters.q,
    reasoning: filters.reasoning,
    status: parseStatus(filters.status),
  }).catch(() => null);
  const results = feedResult?.items ?? [];
  const hasFilters = [
    filters.category,
    filters.contributor,
    filters.model,
    filters.q,
    filters.reasoning,
    filters.status,
  ].some((value) => value?.trim());
  const hasPrevious = page > 1;
  const hasNext = feedResult?.hasNext ?? false;
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLIC RESULTS</span>
          <h1>Every submitted result stays visible.</h1>
          <p>
            Browse code, image, video, and log evidence whether the AI judge has
            ranked it yet or not.
          </p>
        </header>
        <form className="filter-bar" action="/explore" method="get">
          <label>
            <span>Search</span>
            <input
              defaultValue={filters.q}
              name="q"
              placeholder="Result, harness, contributor..."
              type="search"
            />
          </label>
          <label>
            <span>Model</span>
            <input
              defaultValue={filters.model}
              name="model"
              placeholder="Model family or version"
            />
          </label>
          <label>
            <span>Reasoning</span>
            <select defaultValue={filters.reasoning ?? ""} name="reasoning">
              <option value="">All levels</option>
              <option value="none">None</option>
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
            <span>Judge status</span>
            <select defaultValue={filters.status ?? ""} name="status">
              <option value="">All states</option>
              <option value="pending">Pending AI review</option>
              <option value="delayed">Delayed beyond 24 hours</option>
              <option value="ranked">Ranked</option>
              <option value="not-ranked">Not ranked</option>
            </select>
          </label>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
        </form>
        <div className="results-line">
          <span>
            {results.length} public result{results.length === 1 ? "" : "s"} on
            page {page}
          </span>
          <span>
            {feedResult === null ? "Catalog unavailable" : "Newest first"}
          </span>
        </div>
        {results.length > 0 ? (
          <div className="card-grid">
            {results.map((result) => (
              <ShowcaseCard key={result.id} showcase={result} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>
              {feedResult === null
                ? "Public results are temporarily unavailable."
                : hasFilters
                  ? "No matching results on this page."
                  : "No results have been submitted yet."}
            </strong>
            <p>
              New results publish after safety scanning and remain visible
              while AI judging runs.
            </p>
            <div>
              {hasFilters && (
                <Link className="button button-secondary" href="/explore">
                  Clear filters
                </Link>
              )}
              <Link className="button button-primary" href="/submit">
                Submit a result
              </Link>
            </div>
          </div>
        )}
        {(hasPrevious || hasNext) && (
          <nav className="pagination" aria-label="Result pages">
            {hasPrevious ? (
              <Link
                className="button button-secondary"
                href={explorePageHref(filters, page - 1)}
                rel="prev"
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {hasNext ? (
              <Link
                className="button button-secondary"
                href={explorePageHref(filters, page + 1)}
                rel="next"
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function parsePage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE);
  return Number.isSafeInteger(page) && page > 0 && page <= maxPage ? page : 1;
}

function parseStatus(
  value: string | undefined,
): "delayed" | "not-ranked" | "pending" | "ranked" | undefined {
  return value === "delayed" ||
    value === "not-ranked" ||
    value === "pending" ||
    value === "ranked"
    ? value
    : undefined;
}

function explorePageHref(filters: ExploreFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of [
    "category",
    "contributor",
    "model",
    "q",
    "reasoning",
    "status",
  ] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/explore?${query}` : "/explore";
}
