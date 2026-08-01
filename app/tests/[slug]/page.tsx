import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { getPublicBenchmarkPage } from "@/lib/data/public-catalog";
import { listPublicResultLeaderboard } from "@/lib/data/results";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicBenchmarkPage(slug).catch(() => null);
  return {
    title: data?.benchmark.title ?? "Community test",
    description: data
      ? `Prompt, scoring contract, and ranked model results for ${data.benchmark.title}.`
      : undefined,
  };
}

export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { slug } = await params;
  const { version: requestedVersionValue } = await searchParams;
  const [data, leaderboard] = await Promise.all([
    getPublicBenchmarkPage(slug).catch(() => null),
    listPublicResultLeaderboard().catch(() => []),
  ]);
  if (!data) notFound();

  const requestedVersion = Number(requestedVersionValue);
  const current = requestedVersionValue
    ? data.versions.find(
        (version) => Number(version.version) === requestedVersion,
      )
    : data.versions[0];
  if (!current) notFound();
  const currentVersion = Number(current?.version ?? 0);
  const dimensions = data.dimensions.filter(
    (dimension) =>
      String(dimension.benchmark_version_id) === String(current?.id),
  );
  const rankedResults = leaderboard.filter(
    (row) => row.testSlug === slug && row.testVersion === currentVersion,
  );
  let successCriteria: string[] = [];
  try {
    const parsed = JSON.parse(String(current.success_criteria_json)) as unknown;
    if (Array.isArray(parsed)) {
      successCriteria = parsed.filter(
        (criterion): criterion is string => typeof criterion === "string",
      );
    }
  } catch {
    successCriteria = [];
  }

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/tests">Tests</Link>
          <span>/</span>
          <span>Version {currentVersion || "—"}</span>
        </div>
        {data.versions.length > 1 && (
          <nav className="showcase-breadcrumbs" aria-label="Test versions">
            <span>Versions</span>
            {data.versions.map((version) => (
              <Link
                aria-current={
                  Number(version.version) === currentVersion
                    ? "page"
                    : undefined
                }
                href={`/tests/${slug}?version=${Number(version.version)}`}
                key={String(version.id)}
              >
                v{Number(version.version)}
              </Link>
            ))}
          </nav>
        )}
        <header className="page-title split-title">
          <div>
            <span className="section-index">{String(current.category)}</span>
            <h1>{String(current.title)}</h1>
          </div>
          <div>
            <p>
              Every submitted result uses this frozen prompt and rubric. A
              changed prompt or scoring rule becomes a new version.
            </p>
            {current && (
              <div className="wizard-actions">
                <Link
                  className="button button-primary"
                  href={`/submit?test=${encodeURIComponent(String(current.id))}`}
                >
                  Submit a result
                </Link>
                <Link
                  className="button button-secondary"
                  href={`/tests/${slug}/edit`}
                >
                  Create a new version
                </Link>
              </div>
            )}
          </div>
        </header>

        {current && (
          <section className="run-evidence">
            <div>
              <span className="section-index">EXACT TEST PROMPT</span>
              <pre>{String(current.canonical_prompt)}</pre>
            </div>
            <div>
              <span className="section-index">GOAL</span>
              <p>{String(current.goal)}</p>
              {successCriteria.length > 0 && (
                <ul>
                  {successCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <span className="section-index">FROZEN VERSION</span>
              <dl className="provenance-list">
                <div>
                  <dt>Version</dt>
                  <dd>{currentVersion}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>
                    {current.published_at
                      ? new Date(Number(current.published_at)).toLocaleDateString(
                          "en",
                          { dateStyle: "medium" },
                        )
                      : "Not published"}
                  </dd>
                </div>
                <div>
                  <dt>Scoring dimensions</dt>
                  <dd>{dimensions.length}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        <section className="latest">
          <div className="section-heading compact">
            <div>
              <span className="section-index">SCORING CONTRACT</span>
              <h2>What the AI judge checks.</h2>
            </div>
          </div>
          <div className="model-detail-grid">
            {dimensions.map((dimension) => (
              <article key={String(dimension.key)}>
                <span className="status-pill neutral">
                  {Number(dimension.weight_bps) / 100}%
                </span>
                <h2>{String(dimension.title)}</h2>
                <p>{String(dimension.description)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="leaderboard-section">
          <div className="section-heading compact">
            <div>
              <span className="section-index">RANKED RESULTS</span>
              <h2>Compared only within version {currentVersion}.</h2>
            </div>
            <Link className="text-link" href="/explore">
              See all public results →
            </Link>
          </div>
          {rankedResults.length > 0 ? (
            <div className="ranking-board exact-board">
              <div className="ranking-head">
                <span>Rank / result</span>
                <span>Score</span>
                <span>Samples</span>
                <span>Configuration</span>
              </div>
              {rankedResults.map((row) => (
                <div className="ranking-row" key={row.resultSlug}>
                  <div className="ranking-category">
                    <span className="rank-number">{row.rank}</span>
                    <div>
                      <strong>
                        <Link href={`/results/${row.resultSlug}`}>
                          {row.resultTitle}
                        </Link>
                      </strong>
                      <div className="mono muted">
                        {row.model} · {row.modelVersion}
                      </div>
                      <small>Declared, unverified</small>
                    </div>
                  </div>
                  <strong className="score-large">
                    {(row.scoreBps / 100).toFixed(2)}
                  </strong>
                  <span className="mono">{row.sampleCount}</span>
                  <span className="mono">
                    {row.harness} · {row.reasoning}
                    <small>Declared, unverified</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No ranked results for this version yet.</strong>
              <p>
                Submitted results can still be public in pending, delayed, or
                not-ranked states.
              </p>
              {current && (
                <Link
                  className="button button-primary"
                  href={`/submit?test=${encodeURIComponent(String(current.id))}`}
                >
                  Submit the first result
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
