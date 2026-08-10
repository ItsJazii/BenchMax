import Link from "next/link";
import type { ShowcaseCard as Showcase } from "@/lib/domain/catalog";
import { categoryLabels } from "@/lib/domain/catalog";
import { TrustBadge } from "./TrustBadge";

export function ShowcaseCard({ showcase }: { showcase: Showcase }) {
  return (
    <article className={`showcase-card card-${showcase.category}`}>
      <div className="card-visual">
        <span className="card-category">
          {categoryLabels[showcase.category]}
        </span>
        <div className="visual-window" aria-hidden="true">
          <div className="window-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="window-content">
            <div className="window-line wide" />
            <div className="window-line medium" />
            <div className="window-grid">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
        <TrustBadge trust={showcase.trust} />
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>{showcase.model}</span>
          <span>{showcase.harness}</span>
        </div>
        <h3>
          <Link href={`/tests/${showcase.slug}`}>{showcase.title}</Link>
        </h3>
        <p>{showcase.description}</p>
        <small>Declared by contributor — not independently verified</small>
        <div className="evidence-list">
          {showcase.evidence.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="card-meta">
          <span>{simpleStatus(showcase.status, showcase.scoreBps)}</span>
          <span>{showcase.reasoning} reasoning</span>
          {showcase.scoreBps !== null && (
            <strong>{(showcase.scoreBps / 100).toFixed(2)}</strong>
          )}
        </div>
        <div className="card-footer">
          <Link href={`/contributors/${showcase.contributor}`}>
            @{showcase.contributor}
          </Link>
          <span>{showcase.published}</span>
        </div>
      </div>
    </article>
  );
}

function simpleStatus(status: string, scoreBps: number | null) {
  const normalized = status.toLowerCase();
  if (normalized === "ranked" || normalized.includes("ranked #")) {
    return "Ranked";
  }
  if (
    normalized === "reviewed" ||
    scoreBps !== null ||
    normalized.includes("scored")
  ) {
    return "Reviewed";
  }
  return "Awaiting review";
}
