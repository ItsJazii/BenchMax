import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  getPublicLegacyRunEvidence,
  getPublicRunBySlug,
} from "@/lib/data/runs";
import { buildLegacyRunArtifactUrl } from "@/lib/security/usercontent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const run = await getPublicRunBySlug(slug).catch(() => null);
  return {
    title: run ? `${run.model} on ${run.benchmark} — legacy record` : "Legacy run",
    description: run
      ? "A read-only historical Benchmax platform-run record."
      : undefined,
  };
}

export default async function LegacyRunPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const run = await getPublicRunBySlug(slug).catch(() => null);
  if (!run) notFound();
  const evidence = await getPublicLegacyRunEvidence(run.id);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="showcase-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/explore">Current community results</Link>
          <span>/</span>
          <span>Legacy run archive</span>
        </div>
        <header className="showcase-hero">
          <div>
            <span className="status-pill neutral">Read-only legacy record</span>
            <h1>{run.model} on {run.benchmark}</h1>
            <p>
              This run was created by Benchmax&apos;s retired platform-generation
              system. It remains available for historical inspection, but it
              cannot be retried, changed, or entered into current community
              result rankings.
            </p>
            <div className="showcase-byline">
              <Link href={`/contributors/${run.contributorHandle}`}>
                @{run.contributorHandle}
              </Link>
              <time dateTime={run.publishedAt?.toISOString()}>
                {formatTimestamp(run.publishedAt)}
              </time>
            </div>
          </div>
          <div className="showcase-spec">
            <div>
              <span>ARCHIVED SCORE</span>
              <strong>
                {run.overallScoreBps === null
                  ? "Unavailable"
                  : (run.overallScoreBps / 100).toFixed(2)}
              </strong>
            </div>
            <div>
              <span>MODEL</span>
              <strong>{run.model}</strong>
              <small>{run.modelVersion} · historical platform record</small>
            </div>
            <div>
              <span>HARNESS</span>
              <strong>{run.harness}</strong>
              <small>Version {run.harnessVersion}</small>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{run.reasoningLevel}</strong>
            </div>
          </div>
        </header>

        <section className="security-gate">
          <strong>The legacy pipeline is sealed.</strong>
          <p>
            This page performs historical reads only. Benchmax no longer runs
            tested-model generation, accepts model-provider keys, or maintains
            a platform-funded generation balance.
          </p>
          <span className="status-pill neutral">Archive only</span>
        </section>

        <section className="run-score-grid">
          {evidence.dimensions.map((dimension) => (
            <article key={dimension.key}>
              <span className="section-index">ARCHIVED DIMENSION</span>
              <h2>{dimension.title}</h2>
              <strong className="score-large">
                {(
                  (dimension.adjustedCombinedScoreBps ??
                    dimension.originalCombinedScoreBps) / 100
                ).toFixed(2)}
              </strong>
              <p>{dimension.reasoning}</p>
            </article>
          ))}
        </section>

        <section className="run-evidence">
          <div>
            <span className="section-index">FROZEN INPUT</span>
            <h2>Canonical prompt</h2>
            <pre>{run.prompt}</pre>
          </div>
          <div>
            <span className="section-index">ARCHIVED PROVENANCE</span>
            <dl className="provenance-list">
              <div>
                <dt>Request hash</dt>
                <dd>{evidence.provenance?.requestHash ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Response hash</dt>
                <dd>{evidence.provenance?.responseHash ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Environment hash</dt>
                <dd>{run.environmentHash}</dd>
              </div>
              <div>
                <dt>Harness hash</dt>
                <dd>{run.harnessContractHash}</dd>
              </div>
              <div>
                <dt>Settings hash</dt>
                <dd>{run.settingsHash}</dd>
              </div>
              <div>
                <dt>Evaluation version</dt>
                <dd>{run.evaluationVersion}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="run-evidence evidence-detail-grid">
          <div>
            <span className="section-index">PUBLIC ARTIFACTS</span>
            <h2>Archived captures and logs</h2>
            <div className="artifact-list">
              {evidence.artifacts.map((artifact) => (
                <div key={artifact.id}>
                  <span>
                    <strong>{artifact.kind}</strong>
                    <small>
                      {(artifact.byteSize / 1024).toFixed(1)} KB · {artifact.sha256.slice(0, 16)}…
                    </small>
                  </span>
                  <a
                    download
                    href={buildLegacyRunArtifactUrl(
                      run.publicSlug,
                      artifact.id,
                    )}
                  >
                    Download
                  </a>
                </div>
              ))}
              {evidence.artifacts.length === 0 && (
                <p className="muted">No public artifacts were retained.</p>
              )}
            </div>
          </div>
          <div>
            <span className="section-index">ARCHIVED TIMELINE</span>
            <h2>Recorded stages</h2>
            <ol className="evaluation-timeline">
              {[
                ["Created", run.createdAt],
                ["Generation completed", run.generatedAt],
                ["Evaluation completed", run.evaluatedAt],
                ["Scored", run.scoredAt],
                ["Published", run.publishedAt],
              ].map(([label, value]) => (
                <li key={String(label)}>
                  <strong>{String(label)}</strong>
                  <time>{formatTimestamp(value instanceof Date ? value : null)}</time>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="run-score-grid">
          <article>
            <span className="section-index">OBJECTIVE CHECKS</span>
            <h2>Archived sandbox measurements</h2>
            <div className="check-list">
              {evidence.objective.map((result) => (
                <div key={result.checkKey}>
                  <span className={`status-pill ${result.status === "pass" ? "approved" : "pending"}`}>
                    {result.status}
                  </span>
                  <strong>{result.checkKey}</strong>
                  <span>{(result.scoreBps / 100).toFixed(2)}</span>
                </div>
              ))}
              {evidence.objective.length === 0 && (
                <p className="muted">No objective checks were retained.</p>
              )}
            </div>
          </article>
        </section>

        <div className="report-link">
          <Link href={`/report?target=${encodeURIComponent(`/runs/${run.publicSlug}`)}`}>
            Report this archived record →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function formatTimestamp(value: Date | null) {
  return value?.toISOString() ?? "Not recorded";
}
