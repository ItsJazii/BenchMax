import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { getRequestIdentity } from "@/lib/auth/server";
import { getPublicShowcaseEnrichment } from "@/lib/data/showcase-enrichment";
import {
  getBlockedShowcaseForOwnerBySlug,
  getPublicShowcaseBySlug,
} from "@/lib/data/showcases";
import { buildResultArtifactUrl } from "@/lib/security/usercontent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const test = await getPublicShowcaseBySlug(slug).catch(() => null);
  return {
    title: test?.title ?? "Public Test",
    description: test?.summary,
  };
}

export default async function TestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const test = await getPublicShowcaseBySlug(slug).catch(() => null);
  if (!test) {
    const identity = await getRequestIdentity(
      new Request("https://benchmax.invalid/tests", {
        headers: await headers(),
      }),
    ).catch(() => null);
    const blocked = identity
      ? await getBlockedShowcaseForOwnerBySlug(slug, identity.subject).catch(
          () => null,
        )
      : null;
    if (!blocked) notFound();
    return <BlockedTestPage test={blocked} />;
  }

  const enrichment = await getPublicShowcaseEnrichment(test.id).catch(
    () => null,
  );
  const derivedArtifacts = (enrichment?.artifacts ?? []).map((artifact) => ({
    ...artifact,
    fileName: `Automated ${artifact.kind}`,
    url: buildResultArtifactUrl(test.slug, artifact.id),
  }));
  const publishedLabel = test.publishedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(test.publishedAt)
    : "Publication date unavailable";

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="showcase-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/tests">All Tests</Link>
          <span>/</span>
          <span>{test.title}</span>
        </div>
        <header className="showcase-hero">
          <div>
            <span
              className={`status-pill ${statusTone(test.statusLabel)}`}
            >
              {test.statusLabel}
            </span>
            <h1>{test.title}</h1>
            <p>{test.summary}</p>
            <div className="showcase-byline">
              <Link href={`/contributors/${test.contributor}`}>
                @{test.contributor}
              </Link>
              <time dateTime={test.publishedAt?.toISOString()}>
                {publishedLabel}
              </time>
            </div>
          </div>
          <div className="showcase-spec">
            <div>
              <span>MODEL</span>
              <strong>{test.model}</strong>
              <small>{test.modelVersion}</small>
            </div>
            <div>
              <span>HARNESS</span>
              <strong>{test.harness}</strong>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{test.reasoning}</strong>
            </div>
            {test.scoreBps !== null && (
              <div>
                <span>SCORE</span>
                <strong>{(test.scoreBps / 100).toFixed(2)}</strong>
              </div>
            )}
            {test.rank && (
              <div>
                <span>RANK</span>
                <strong>#{test.rank}</strong>
              </div>
            )}
          </div>
        </header>

        <section className="security-gate">
          <strong>Declared by contributor — not independently verified</strong>
          <p>
            The named model, version, harness, reasoning, and settings describe
            what the contributor says produced this evidence.
          </p>
        </section>

        <section className="test-context">
          <div>
            <span className="section-index">TEST DETAILS</span>
            <h2>Inspect the exact prompt and declared setup.</h2>
          </div>
          <div className="context-grid">
            <article>
              <span>PROMPT</span>
              <pre>{test.prompt}</pre>
            </article>
            {test.systemPrompt && (
              <article>
                <span>SYSTEM PROMPT</span>
                <pre>{test.systemPrompt}</pre>
              </article>
            )}
            <article>
              <span>SETTINGS</span>
              <pre>{formatSettings(test.declaredSettings)}</pre>
            </article>
          </div>
        </section>

        <EvidenceSection
          artifacts={test.artifacts.map((artifact) => ({
            ...artifact,
            fileName: artifact.fileName,
          }))}
          heading="Uploaded output and evidence"
          label="SUBMITTED EVIDENCE"
        />

        {derivedArtifacts.length > 0 && (
          <EvidenceSection
            artifacts={derivedArtifacts}
            heading="Automated preview evidence"
            label="AUTOMATED PREVIEW"
          />
        )}

        {enrichment?.availability === "unavailable" && (
          <section className="security-gate">
            <strong>Automated preview unavailable</strong>
          </section>
        )}

        <div className="report-link">
          <Link
            href={`/report?target=${encodeURIComponent(`/tests/${test.slug}`)}`}
          >
            Report this Test →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

type EvidenceArtifact = {
  byteSize: number;
  contentType: string;
  fileName: string;
  id: string;
  kind: string;
  url: string;
};

function EvidenceSection({
  artifacts,
  heading,
  label,
}: {
  artifacts: EvidenceArtifact[];
  heading: string;
  label: string;
}) {
  return (
    <section className="test-context">
      <div>
        <span className="section-index">{label}</span>
        <h2>{heading}</h2>
      </div>
      {artifacts.length > 0 ? (
        <ul className="artifact-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              {artifact.contentType.startsWith("image/") && (
                <a
                  aria-label={`Open ${artifact.fileName}`}
                  className="artifact-preview artifact-image"
                  href={artifact.url}
                >
                  <Image
                    alt={artifact.fileName}
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
                  <source src={artifact.url} type={artifact.contentType} />
                  <a href={artifact.url}>Download {artifact.fileName}</a>
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
        <p>No public evidence is available.</p>
      )}
    </section>
  );
}

function BlockedTestPage({
  test,
}: {
  test: NonNullable<
    Awaited<ReturnType<typeof getBlockedShowcaseForOwnerBySlug>>
  >;
}) {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/tests">All Tests</Link>
          <span>/</span>
          <span>Owner view</span>
        </div>
        <section className="security-gate">
          <span className="status-pill blocked">Blocked</span>
          <h1>{test.title}</h1>
          <strong>This Test is private to you.</strong>
          <p>
            Its evidence did not pass the mandatory safety scan, so it is not
            visible in All Tests or to other visitors.
          </p>
          <Link className="button button-secondary" href="/dashboard">
            Open dashboard
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function formatSettings(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return "No additional settings declared.";
  }
  return JSON.stringify(value, null, 2);
}

function statusTone(status: string) {
  if (status === "Ranked") return "approved";
  if (status === "Reviewed") return "neutral";
  return "pending";
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}
