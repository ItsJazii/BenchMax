import Link from "next/link";
import { categoryLabels, type Category } from "@/lib/domain/catalog";

export type PublicRunCard = {
  id: string;
  publicSlug: string;
  overallScoreBps: number | null;
  publishedAt: Date | null;
  category: Category;
  benchmark: string;
  benchmarkVersion: number;
  model: string;
  modelVersion: string;
  reasoningLevel: string;
  harness: string;
  harnessVersion: number;
  contributorHandle: string;
  postPublicationMarker: boolean;
};

export function RunCard({ run }: { run: PublicRunCard }) {
  return (
    <article className={`showcase-card card-${run.category}`}>
      <div className="card-visual run-card-visual">
        <span className="card-category">{categoryLabels[run.category]}</span>
        <strong className="run-card-score">
          {((run.overallScoreBps ?? 0) / 100).toFixed(2)}
        </strong>
        <span className="status-pill approved">Platform Generated</span>
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>
            {run.model} · {run.modelVersion}
          </span>
          <span>{run.reasoningLevel} reasoning</span>
        </div>
        <h3>
          <Link href={`/runs/${run.publicSlug}`}>
            {run.model} on {run.benchmark}
          </Link>
        </h3>
        <p>
          Benchmark v{run.benchmarkVersion} · {run.harness} v
          {run.harnessVersion} · pass@1
        </p>
        <div className="evidence-list">
          <span>Source</span>
          <span>Logs</span>
          <span>Judge evidence</span>
          {run.postPublicationMarker && <span>Contamination marker</span>}
        </div>
        <div className="card-footer">
          <Link href={`/contributors/${run.contributorHandle}`}>
            @{run.contributorHandle}
          </Link>
          <span>{run.publishedAt?.toISOString() ?? "Published"}</span>
        </div>
      </div>
    </article>
  );
}
