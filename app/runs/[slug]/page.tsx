import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import {
  getPublicRunBySlug,
  getPublicRunEvidence,
} from "@/lib/data/runs";
import { listPublicRunDisputes } from "@/lib/data/community";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const run = await getPublicRunBySlug(slug);
  return {
    title: run ? `${run.model} on ${run.benchmark}` : "Benchmark run",
    description: run
      ? `Inspect the platform-generated ${run.model} benchmark run, artifacts, and score.`
      : undefined,
  };
}

export default async function RunPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const run = await getPublicRunBySlug(slug);
  if (!run) notFound();
  const evidence = await getPublicRunEvidence(run.id);
  const disputes = await listPublicRunDisputes(run.id);
  const usercontentOrigin =
    process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN?.replace(/\/+$/, "") ?? null;
  const playableUrl =
    run.playableEnabled && usercontentOrigin
      ? `${usercontentOrigin}/run/${run.id}/index.html`
      : null;

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="showcase-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/leaderboards">Leaderboards</Link>
          <span>/</span>
          <span>{run.benchmark}</span>
        </div>
        <header className="showcase-hero">
          <div>
            <span className="status-pill approved">Platform generated</span>
            <h1>
              {run.model} on {run.benchmark}
            </h1>
            <p>
              A pass@1 run generated, executed, and scored by the frozen
              Benchmax pipeline. The code is model-generated under the
              contributor&apos;s selected provider account.
            </p>
            <div className="showcase-byline">
              <Link href={`/contributors/${run.contributorHandle}`}>
                @{run.contributorHandle}
              </Link>
              <span>{run.publishedAt?.toISOString()}</span>
              {run.postPublicationMarker && (
                <span>Post-publication training cutoff</span>
              )}
            </div>
          </div>
          <div className="showcase-spec">
            <div>
              <span>SCORE</span>
              <strong>{((run.overallScoreBps ?? 0) / 100).toFixed(2)}</strong>
            </div>
            <div>
              <span>MODEL VERSION</span>
              <strong>{run.modelVersion}</strong>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{run.reasoningLevel}</strong>
            </div>
            <div>
              <span>RANK ELIGIBLE</span>
              <strong>{run.injectionFlag ? "No — flagged" : "Yes"}</strong>
            </div>
          </div>
        </header>

        {playableUrl ? (
          <section className="playable-stage">
            <div className="preview-toolbar">
              <span>ISOLATED PLAYABLE OUTPUT</span>
              <span>SEPARATE COOKIELESS ORIGIN · NETWORK BLOCKED</span>
            </div>
            <iframe
              allow="fullscreen"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts"
              src={playableUrl}
              title={`Playable output for ${run.model} on ${run.benchmark}`}
            />
          </section>
        ) : (
          <div className="security-gate">
            <strong>Playable output is locked.</strong>
            <p>
              The separate user-content origin must be configured, or this run
              was safety-flagged. Generated code never executes on the main
              Benchmax origin.
            </p>
          </div>
        )}

        <section className="run-score-grid">
          {evidence.dimensions.map((dimension) => (
            <article key={dimension.key}>
              <span className="section-index">{dimension.mechanism}</span>
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
            <span className="section-index">PUBLIC PROVENANCE</span>
            <dl className="provenance-list">
              <div>
                <dt>Request hash</dt>
                <dd>{evidence.provenance?.requestHash ?? "Generation failed"}</dd>
              </div>
              <div>
                <dt>Response hash</dt>
                <dd>{evidence.provenance?.responseHash ?? "Generation failed"}</dd>
              </div>
              <div>
                <dt>Provenance hash</dt>
                <dd>{evidence.provenance?.provenanceHash ?? "Generation failed"}</dd>
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
            </dl>
          </div>
        </section>
        {evidence.provenance && (
          <details className="transcript-panel">
            <summary>Open redacted model transcript</summary>
            <pre>{evidence.provenance.redactedTranscript}</pre>
          </details>
        )}
        <section className="run-evidence evidence-detail-grid">
          <div>
            <span className="section-index">PUBLIC ARTIFACTS</span>
            <h2>Source, captures, and logs</h2>
            <div className="artifact-list">
              {evidence.artifacts.map((artifact) => (
                <div key={artifact.id}>
                  <span>
                    <strong>{artifact.kind}</strong>
                    <small>
                      {(artifact.byteSize / 1024).toFixed(1)} KB ·{" "}
                      {artifact.sha256.slice(0, 16)}…
                    </small>
                  </span>
                  <a
                    download
                    href={`/api/public/runs/${run.publicSlug}/artifacts/${artifact.id}`}
                  >
                    Download
                  </a>
                </div>
              ))}
              {evidence.artifacts.length === 0 && (
                <p className="muted">
                  No public artifacts were captured for this scored failure.
                </p>
              )}
            </div>
          </div>
          <div>
            <span className="section-index">EVALUATION TIMELINE</span>
            <h2>Every completed stage</h2>
            <ol className="evaluation-timeline">
              {[
                ["Run created", run.createdAt],
                ["Generation completed", run.generatedAt],
                ["Evaluation completed", run.evaluatedAt],
                ["Judging completed", run.scoredAt],
                ["Snapshot published", run.publishedAt],
              ].map(([label, date]) => (
                <li key={String(label)}>
                  <strong>{String(label)}</strong>
                  <time>
                    {date instanceof Date
                      ? date.toISOString()
                      : "Not reached"}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="run-score-grid">
          <article>
            <span className="section-index">OBJECTIVE CHECKS</span>
            <h2>Measured in the sandbox</h2>
            <div className="check-list">
              {evidence.objective.map((result) => (
                <div key={result.checkKey}>
                  <span
                    className={`status-pill ${
                      result.status === "pass" ? "approved" : "pending"
                    }`}
                  >
                    {result.status}
                  </span>
                  <strong>{result.checkKey}</strong>
                  <span>{(result.scoreBps / 100).toFixed(2)}</span>
                  <code>{result.metricValueJson}</code>
                </div>
              ))}
              {evidence.objective.length === 0 && (
                <p className="muted">No objective checks were recorded.</p>
              )}
            </div>
          </article>
          <article>
            <span className="section-index">PINNED JUDGE · K=3</span>
            <h2>Stored samples</h2>
            <div className="judge-sample-list">
              {evidence.samples.map((sample) => (
                <details key={sample.sampleIndex}>
                  <summary>
                    Sample {sample.sampleIndex + 1} ·{" "}
                    {sample.injectionFlag ? "flagged" : "screened"} ·{" "}
                    {sample.responseHash.slice(0, 12)}…
                  </summary>
                  <pre>{sample.structuredOutputJson}</pre>
                </details>
              ))}
              {evidence.samples.length === 0 && (
                <p className="muted">No judge samples were recorded.</p>
              )}
            </div>
          </article>
        </section>
        <section className="dispute-list">
          <div className="section-heading compact">
            <div>
              <span className="section-index">PUBLIC CHALLENGES</span>
              <h2>Disputes and resolutions</h2>
            </div>
            <Link
              className="button button-secondary"
              href={`/disputes/new?run=${encodeURIComponent(run.id)}`}
            >
              Open dispute
            </Link>
          </div>
          {disputes.length === 0 ? (
            <p className="muted">No disputes have been opened on this run.</p>
          ) : (
            disputes.map((dispute) => (
              <article key={dispute.id}>
                <div>
                  <strong>@{dispute.openedByHandle}</strong>
                  <span className="status-pill neutral">{dispute.status}</span>
                </div>
                <p>{dispute.reason}</p>
                {dispute.resolution && (
                  <blockquote>{dispute.resolution}</blockquote>
                )}
              </article>
            ))
          )}
        </section>
        <div className="report-link">
          <Link href={`/report?target=${encodeURIComponent(`/runs/${run.publicSlug}`)}`}>
            Report or dispute this run →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
