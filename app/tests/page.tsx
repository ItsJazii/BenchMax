import type { Metadata } from "next";
import Link from "next/link";
import { ShowcaseCard } from "@/app/components/ShowcaseCard";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicShowcaseCardsPage } from "@/lib/data/showcases";
import { categoryLabels } from "@/lib/domain/catalog";

const PAGE_SIZE = 24;

type TestFilters = {
  category?: string;
  contributor?: string;
  harness?: string;
  model?: string;
  page?: string;
  q?: string;
  reasoning?: string;
  status?: string;
};

export const metadata: Metadata = {
  title: "All Tests",
  description:
    "Browse public AI Tests with their prompts, declared setup, contributor, and output evidence.",
};

export default async function TestsPage({
  searchParams,
}: {
  searchParams?: Promise<TestFilters>;
}) {
  const filters = (await searchParams) ?? {};
  const page = parsePage(filters.page);
  const feedResult = await listPublicShowcaseCardsPage({
    category: filters.category,
    contributor: filters.contributor,
    harness: filters.harness,
    limit: PAGE_SIZE,
    model: filters.model,
    offset: (page - 1) * PAGE_SIZE,
    q: filters.q,
    reasoning: filters.reasoning,
    status: dataStatus(filters.status),
  }).catch(() => null);
  const tests = feedResult?.items ?? [];
  const hasFilters = [
    filters.category,
    filters.contributor,
    filters.harness,
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
          <span className="section-index">ALL TESTS</span>
          <h1>See what people tested and what the model produced.</h1>
          <p>
            Every safe Test is public with its prompt, declared setup, output
            evidence, and contributor. Reviews and rankings are added later.
          </p>
        </header>
        <form className="filter-bar" action="/tests" method="get">
          <label>
            <span>Search</span>
            <input
              defaultValue={filters.q}
              name="q"
              placeholder="Prompt, Test, harness, contributor..."
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
            <span>Harness</span>
            <input
              defaultValue={filters.harness}
              name="harness"
              placeholder="Harness or runner"
            />
          </label>
          <label>
            <span>Reasoning</span>
            <select defaultValue={filters.reasoning ?? ""} name="reasoning">
              <option value="">All settings</option>
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
              <option value="unknown">Unknown / adaptive</option>
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
            <span>Status</span>
            <select defaultValue={filters.status ?? ""} name="status">
              <option value="">All public statuses</option>
              <option value="awaiting-review">Awaiting review</option>
              <option value="reviewed">Reviewed</option>
              <option value="ranked">Ranked</option>
            </select>
          </label>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
        </form>
        <div className="results-line">
          <span>
            {tests.length} public Test{tests.length === 1 ? "" : "s"} on page{" "}
            {page}
          </span>
          <span>{feedResult === null ? "Feed unavailable" : "Newest first"}</span>
        </div>
        {tests.length > 0 ? (
          <div className="card-grid">
            {tests.map((test) => (
              <ShowcaseCard key={test.id} showcase={test} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>
              {feedResult === null
                ? "All Tests is temporarily unavailable."
                : hasFilters
                  ? "No Tests match these filters."
                  : "No public Tests yet."}
            </strong>
            <p>
              Safe Tests appear here as Awaiting review. They do not need a
              score to be useful or public.
            </p>
            <div>
              {hasFilters && (
                <Link className="button button-secondary" href="/tests">
                  Clear filters
                </Link>
              )}
              <Link className="button button-primary" href="/submit">
                Submit a Test
              </Link>
            </div>
          </div>
        )}
        {(hasPrevious || hasNext) && (
          <nav className="pagination" aria-label="Test pages">
            {hasPrevious ? (
              <Link
                className="button button-secondary"
                href={testPageHref(filters, page - 1)}
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
                href={testPageHref(filters, page + 1)}
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

function dataStatus(
  value: string | undefined,
): "not-ranked" | "pending" | "ranked" | undefined {
  if (value === "awaiting-review") return "pending";
  if (value === "reviewed") return "not-ranked";
  if (value === "ranked") return "ranked";
  return undefined;
}

function testPageHref(filters: TestFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of [
    "category",
    "contributor",
    "harness",
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
  return query ? `/tests?${query}` : "/tests";
}
