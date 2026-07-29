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
    index: "01",
    title: "Frontend",
    status: "Runner ready",
    count: "5",
    description:
      "Responsive interfaces, interactions, accessibility, runtime stability, and task adherence.",
  },
  {
    index: "02",
    title: "Browser games",
    status: "Runner ready",
    count: "5",
    description:
      "Playable loops, input response, console stability, frame pacing, and game-specific rubric checks.",
  },
  {
    index: "03",
    title: "Browser 3D",
    status: "Runner ready",
    count: "4",
    description:
      "WebGL scenes, navigation, seeded capture milestones, load stability, and bounded performance checks.",
  },
];

export default async function BenchmarksPage() {
  const versions = await listPublicBenchmarkVersions().catch(() => []);
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
          {categories.map((category) => (
            <article key={category.title}>
              <div className="benchmark-number">{category.index}</div>
              <span className="status-pill pending">{category.status}</span>
              <h2>{category.title}</h2>
              <p>{category.description}</p>
              <div className="benchmark-base">
                <span>{category.count} launch definitions</span>
                <span>Owner curated</span>
              </div>
            </article>
          ))}
        </div>

        {versions.length > 0 && (
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
