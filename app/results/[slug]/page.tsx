import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { getRequestIdentity } from "@/lib/auth/server";
import {
  getBlockedShowcaseForOwnerBySlug,
  getPublicShowcaseBySlug,
} from "@/lib/data/showcases";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicShowcaseBySlug(slug).catch(() => null);
  return {
    title: result?.title ?? "Model test result",
    description: result?.summary,
  };
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getPublicShowcaseBySlug(slug).catch(() => null);
  if (!result) {
    const identity = await getRequestIdentity(
      new Request("https://benchmax.invalid/results", {
        headers: await headers(),
      }),
    ).catch(() => null);
    const blocked = identity
      ? await getBlockedShowcaseForOwnerBySlug(slug, identity.subject).catch(
          () => null,
        )
      : null;
    if (!blocked) notFound();
    return <BlockedResultPage result={blocked} />;
  }
  const pending = ["queued", "evaluating", "judging"].includes(
    result.judgeStatus,
  );
  const delayed = result.judgeStatus === "overdue";
  const notRanked =
    !pending && !delayed && result.rank === null;
  const publishedLabel = result.publishedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(result.publishedAt)
    : "Publication time unavailable";
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="showcase-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/explore">Results</Link>
          <span>/</span>
          <Link
            href={`/tests/${result.testSlug}?version=${result.testVersion}`}
          >
            {result.testTitle}
          </Link>
          <span>/</span>
          <span>v{result.testVersion}</span>
        </div>
        <header className="showcase-hero">
          <div>
            <span
              className={`status-pill ${
                result.rank
                  ? "approved"
                  : pending || delayed
                    ? "pending"
                    : "neutral"
              }`}
            >
              {result.statusLabel}
            </span>
            <h1>{result.title}</h1>
            <p>{result.summary}</p>
            <div className="showcase-byline">
              <Link href={`/contributors/${result.contributor}`}>
                @{result.contributor}
              </Link>
              <time dateTime={result.publishedAt?.toISOString()}>
                {publishedLabel} UTC
              </time>
            </div>
          </div>
          <div className="showcase-spec">
            <div>
              <span>TEST</span>
              <strong>
                <Link
                  href={`/tests/${result.testSlug}?version=${result.testVersion}`}
                >
                  {result.testTitle}
                </Link>
              </strong>
              <small>Version {result.testVersion}</small>
            </div>
            <div>
              <span>MODEL</span>
              <strong>{result.model}</strong>
              <small>
                {result.modelVersion} · {result.provenance.label}
              </small>
            </div>
            <div>
              <span>HARNESS</span>
              <strong>{result.harness}</strong>
              <small>{result.provenance.label}</small>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{result.reasoning}</strong>
              <small>{result.provenance.label}</small>
            </div>
            <div>
              <span>AI SCORE</span>
              <strong>
                {result.scoreBps === null
                  ? "Pending"
                  : (result.scoreBps / 100).toFixed(2)}
              </strong>
              {result.rank && <small>Rank #{result.rank}</small>}
              {result.evaluation && !result.evaluation.current && (
                <small>
                  Historical evaluation v{result.evaluation.version}; no current rank
                </small>
              )}
            </div>
          </div>
        </header>

        <section className="security-gate">
          <strong>{result.provenance.label} configuration metadata</strong>
          <p>{result.provenance.note}</p>
          <p className="mono">
            Settings {JSON.stringify(result.declaredSettings)} · configuration{" "}
            {result.configurationHash}
          </p>
          <span className="status-pill neutral">Contributor declaration</span>
        </section>

        {pending && (
          <section className="security-gate">
            <strong>AI review is in progress.</strong>
            <p>
              This result is already public. Benchmax aims to finish judging
              within 24 hours
              {result.judgeDueAt
                ? ` (by ${new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  }).format(result.judgeDueAt)} UTC)`
                : ""}
              .
            </p>
            <span className="status-pill pending">Visible now</span>
          </section>
        )}
        {delayed && (
          <section className="security-gate">
            <strong>AI review is taking longer than 24 hours.</strong>
            <p>
              The result and its evidence remain public. It will not receive a
              rank until review finishes and ranking eligibility is confirmed.
            </p>
            <span className="status-pill pending">Delayed</span>
          </section>
        )}
        {notRanked && (
          <section className="security-gate">
            <strong>This result is public but not ranked.</strong>
            <p>
              The public status above records the current reason. Its submitted
              context and approved evidence remain available for inspection.
            </p>
            <span className="status-pill neutral">Not ranked</span>
          </section>
        )}

        {result.scoreBps !== null && (
          <section className="evaluation-receipt">
            <div className="section-heading compact">
              <div>
                <span className="section-index">AI JUDGMENT</span>
                <h2>How this result scored.</h2>
              </div>
              <span className="status-pill approved">
                {result.judgeSampleCount} judge{" "}
                {result.judgeSampleCount === 1 ? "sample" : "samples"}
              </span>
            </div>

            <div className="evaluation-summary">
              <article>
                <span>FINAL SCORE</span>
                <strong>{(result.scoreBps / 100).toFixed(2)}</strong>
                <small>out of 100</small>
              </article>
              <article>
                <span>REVIEW TIMING</span>
                <dl>
                  <div>
                    <dt>Evaluated</dt>
                    <dd>{formatTimestamp(result.evaluatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Scored</dt>
                    <dd>{formatTimestamp(result.scoredAt)}</dd>
                  </div>
                </dl>
              </article>
            </div>

            {result.dimensions.length > 0 && (
              <div className="dimension-score-list">
                {result.dimensions.map((dimension) => {
                  const score = Number(dimension.finalScoreBps);
                  return (
                    <article key={dimension.key}>
                      <div className="dimension-score-heading">
                        <div>
                          <span>
                            {Number(dimension.weightBps) / 100}% of final score
                          </span>
                          <h3>{dimension.title}</h3>
                        </div>
                        <strong>{(score / 100).toFixed(2)}</strong>
                      </div>
                      <div
                        aria-label={`${dimension.title}: ${(score / 100).toFixed(2)} out of 100`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={score / 100}
                        className="dimension-score-meter"
                        role="meter"
                      >
                        <span
                          style={{
                            width: `${Math.min(Math.max(score / 100, 0), 100)}%`,
                          }}
                        />
                      </div>
                      <p>{dimension.reasoning}</p>
                      <small>{dimension.description}</small>
                    </article>
                  );
                })}
              </div>
            )}

            {result.evaluation && (
              <div className="evaluation-snapshot">
                <div>
                  <span className="section-index">IMMUTABLE EVALUATION SNAPSHOT</span>
                  <h3>Version {result.evaluation.version}</h3>
                  <p>
                    This score remains tied to the judge and protocol snapshot
                    shown here, even after Benchmax adopts a newer evaluator.
                  </p>
                  <span
                    className={`status-pill ${result.evaluation.current ? "approved" : "neutral"}`}
                  >
                    {result.evaluation.current
                      ? "Current published evaluation"
                      : "Historical evaluation"}
                  </span>
                </div>
                <dl className="provenance-list">
                  <div>
                    <dt>Judge</dt>
                    <dd>
                      {result.evaluation.provider} · {result.evaluation.model} ·{" "}
                      {result.evaluation.modelVersion}
                    </dd>
                  </div>
                  <div>
                    <dt>Rubric protocol</dt>
                    <dd>{result.evaluation.rubricProtocolVersion}</dd>
                  </div>
                  <div>
                    <dt>Prompt template hash</dt>
                    <dd>{result.evaluation.promptTemplateHash}</dd>
                  </div>
                  <div>
                    <dt>Calibration set hash</dt>
                    <dd>{result.evaluation.calibrationSetHash}</dd>
                  </div>
                </dl>
              </div>
            )}
          </section>
        )}

        <section className="test-context">
          <div>
            <span className="section-index">SUBMITTED EVIDENCE</span>
            <h2>The result stays inspectable before and after judging.</h2>
          </div>
          <div className="context-grid">
            <article>
              <span>TEST</span>
              <p>
                <Link
                  href={`/tests/${result.testSlug}?version=${result.testVersion}`}
                >
                  {result.testTitle} · version {result.testVersion}
                </Link>
              </p>
            </article>
            <article>
              <span>PROMPT USED</span>
              <p>{result.prompt}</p>
            </article>
            {result.systemPrompt && (
              <article>
                <span>SYSTEM PROMPT</span>
                <p>{result.systemPrompt}</p>
              </article>
            )}
            <article>
              <span>EVIDENCE</span>
              {result.artifacts.length > 0 ? (
                <ul className="artifact-list">
                  {result.artifacts.map((artifact) => (
                    <li key={artifact.id}>
                      {artifact.contentType.startsWith("image/") && (
                        <a
                          aria-label={`Open ${artifact.fileName}`}
                          className="artifact-preview artifact-image"
                          href={artifact.url}
                        >
                          <Image
                            alt={`Submitted result evidence: ${artifact.fileName}`}
                            fill
                            sizes="(max-width: 900px) 100vw, 720px"
                            src={artifact.url}
                            unoptimized
                          />
                        </a>
                      )}
                      {artifact.contentType.startsWith("video/") && (
                        <video
                          className="artifact-preview artifact-video"
                          controls
                          preload="metadata"
                        >
                          <source
                            src={artifact.url}
                            type={artifact.contentType}
                          />
                          <a href={artifact.url}>Download the submitted video</a>
                        </video>
                      )}
                      <div>
                        <strong>{artifact.fileName}</strong>
                        <small>
                          {artifact.kind} · {artifact.contentType} ·{" "}
                          {formatBytes(artifact.byteSize)}
                        </small>
                      </div>
                      <a href={artifact.url}>Download</a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No public artifact metadata is available.</p>
              )}
            </article>
            <article>
              <span>RANKING STATUS</span>
              <p>{result.statusLabel}</p>
            </article>
          </div>
        </section>
        <div className="report-link">
          <Link
            href={`/report?target=${encodeURIComponent(`/results/${result.slug}`)}`}
          >
            Report this result →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function BlockedResultPage({
  result,
}: {
  result: NonNullable<
    Awaited<ReturnType<typeof getBlockedShowcaseForOwnerBySlug>>
  >;
}) {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/explore">Results</Link>
          <span>/</span>
          <span>Owner view</span>
        </div>
        <section className="security-gate">
          <span className="status-pill blocked">Blocked</span>
          <h1>{result.title}</h1>
          <strong>This result is private to you while it is blocked.</strong>
          <p>
            The uploaded evidence did not pass the safety scan. It is not
            visible in the public feed or to other visitors.
          </p>
          <p className="mono">Updated {result.updatedAt.toISOString()} UTC</p>
          <Link className="button button-secondary" href="/dashboard">
            Open dashboard
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "Not recorded";
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}
