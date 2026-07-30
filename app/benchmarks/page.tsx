import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { listPublicBenchmarkVersions } from "@/lib/data/public-catalog";

export const metadata: Metadata = {
  title: "Benchmarks",
  description:
    "Versioned Benchmax benchmark definitions, harness contracts, and launch coverage.",
};

const categories = [
  {
    category: "frontend",
    index: "01",
    title: "Frontend",
    description:
      "Responsive interfaces, interactions, accessibility, runtime stability, and task adherence.",
  },
  {
    category: "browser-game",
    index: "02",
    title: "Browser games",
    description:
      "Playable loops, input response, console stability, frame pacing, and game-specific rubric checks.",
  },
  {
    category: "browser-3d",
    index: "03",
    title: "Browser 3D",
    description:
      "WebGL scenes, navigation, seeded capture milestones, load stability, and bounded performance checks.",
  },
];

export default async function BenchmarksPage() {
  const versionsResult = await listPublicBenchmarkVersions().catch(() => null);
  const versions = versionsResult ?? [];
  const categoryCoverage = new Map<string, Set<string>>();
  for (const version of versions) {
    const benchmarks =
      categoryCoverage.get(version.category) ?? new Set<string>();
    benchmarks.add(version.slug);
    categoryCoverage.set(version.category, benchmarks);
  }
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">VERSIONED TEST DEFINITIONS</span>
          <h1>A benchmark is a contract.</h1>
          <p>
            Prompt, agent loop, tools, context budget, environment, rubric, and
            attempts are frozen together. Change one and it becomes a new
            version.
          </p>
        </header>

        <div className="benchmark-grid">
          {categories.map((category) => {
            const count = categoryCoverage.get(category.category)?.size ?? 0;
            return (
              <article key={category.title}>
                <div className="benchmark-number">{category.index}</div>
                <span
                  className={`status-pill ${count > 0 ? "approved" : "neutral"}`}
                >
                  {versionsResult === null
                    ? "Catalog unavailable"
                    : count > 0
                      ? "Active definitions"
                      : "Awaiting definitions"}
                </span>
                <h2>{category.title}</h2>
                <p>{category.description}</p>
                <div className="benchmark-base">
                  <span>
                    {versionsResult === null
                      ? "Count unavailable"
                      : `${count} active benchmark${count === 1 ? "" : "s"}`}
                  </span>
                  <span>Versioned contracts</span>
                </div>
              </article>
            );
          })}
        </div>

        {versions.length > 0 ? (
          <section className="catalog-note">
            <span>ACTIVE VERSIONS</span>
            <h2>Frozen launch contracts</h2>
            <div className="benchmark-version-list">
              {versions.map((version) => (
                <article key={version.id}>
                  <div>
                    <strong>
                      <Link href={`/benchmarks/${version.slug}`}>
                        {version.title}
                      </Link>
                    </strong>
                    <span className="status-pill approved">
                      {version.attempt_policy}
                    </span>
                  </div>
                  <p>
                    v{version.version} · {version.harness_name} v
                    {version.harness_version} · {version.run_count} runs
                  </p>
                  <code>{version.environment_hash}</code>
                </article>
              ))}
            </div>
          </section>
        ) : versionsResult === null ? (
          <section className="empty-state">
            <strong>The benchmark catalog is temporarily unavailable.</strong>
            <p>
              Benchmax does not show launch-count placeholders while active
              contracts cannot be read.
            </p>
          </section>
        ) : (
          <section className="empty-state">
            <strong>No active benchmark versions yet.</strong>
            <p>
              Published benchmark contracts will appear here after their prompt,
              harness, environment, attempt policy, and rubric are frozen.
            </p>
          </section>
        )}

        <section className="locked-contract">
          <div>
            <span className="section-index">FROZEN PER VERSION</span>
            <h2>The full Benchmax Web Agent contract</h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              Canonical prompt and system instructions
            </li>
            <li>
              <span>02</span>
              Allowed tools and file-operation policy
            </li>
            <li>
              <span>03</span>
              Context budget, turn limit, and dependency policy
            </li>
            <li>
              <span>04</span>
              Environment image hash and evaluation rubric
            </li>
          </ol>
          <Link className="text-link" href="/methodology">
            See the complete protocol →
          </Link>
        </section>
        <div className="closing-cta">
          <p>See a missing task that would expose real model differences?</p>
          <h2>Propose it with an explicit rubric.</h2>
          <Link className="button button-primary" href="/proposals/new">
            Propose a benchmark
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
