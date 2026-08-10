import { env } from "cloudflare:workers";
import {
  computeSubmissionState,
  type SubmissionState,
} from "@/lib/domain/submission-state";

type SubmissionRow = {
  id: string;
  slug: string;
  title: string;
  showcase_status: string;
  safety_status: string;
  judge_status: string;
  ranking_status: string;
  judge_due_at: number | null;
  updated_at: number;
  run_id: string | null;
  run_status: string | null;
  processing_failure_code: string | null;
  processing_failure_summary: string | null;
  processing_failed_at: number | null;
  run_failure_code: string | null;
  run_failure_summary: string | null;
  score_bps: number | null;
  rank: number | null;
  benchmark_version_id: string | null;
  benchmark: string | null;
  model: string;
  model_version: string | null;
  harness: string;
  reasoning: string;
  enrichment_status: string | null;
  enrichment_failure_code: string | null;
};

type AuditRow = {
  event_id: string;
  showcase_id: string;
  action: string;
  metadata_json: string;
  created_at: number;
};

type StageRow = {
  claim_id: string;
  showcase_id: string;
  stage: string;
  status: string;
  attempt_count: number;
  error_code: string | null;
  created_at: number;
  updated_at: number;
};

export type SubmissionTimelineEvent = {
  key: string;
  label: string;
  detail: string | null;
  status: "completed" | "failed" | "info" | "pending";
  occurredAt: string;
};

export type ContributorSubmission = {
  id: string;
  slug: string;
  title: string;
  benchmark: string | null;
  model: string;
  modelVersion: string | null;
  harness: string;
  reasoning: string;
  scoreBps: number | null;
  rank: number | null;
  judgeDueAt: string | null;
  updatedAt: string;
  canPublish: boolean;
  state: SubmissionState;
  timeline: SubmissionTimelineEvent[];
  enrichment: {
    status: string;
    failureCode: string | null;
    canRetry: boolean;
  } | null;
  processing: {
    failureCode: string;
    failedAt: string | null;
    canRetry: true;
  } | null;
};

export async function getContributorSubmissions(ownerId: string) {
  const [submissions, audit, stages] = await Promise.all([
    env.DB.prepare(
      `SELECT
         s.id,
         s.slug,
         s.title,
         s.status AS showcase_status,
         s.safety_status,
         s.judge_status,
         s.ranking_status,
         s.judge_due_at,
         s.updated_at,
         r.id AS run_id,
         r.status AS run_status,
         s.processing_failure_code,
         s.processing_failure_summary,
         s.processing_failed_at,
         r.failure_code AS run_failure_code,
         r.failure_summary AS run_failure_summary,
         r.overall_score_bps AS score_bps,
         s.benchmark_version_id,
         bv.title AS benchmark,
         coalesce(rc.model_label, s.model_label) AS model,
         rc.model_version_label AS model_version,
         coalesce(rc.harness_label, s.harness) AS harness,
         coalesce(rc.reasoning_normalized, s.reasoning_level) AS reasoning,
         enrichment.status AS enrichment_status,
         enrichment.failure_code AS enrichment_failure_code,
         (
           SELECT entry.rank
           FROM result_leaderboard_entries entry
           INNER JOIN result_leaderboard_snapshots snapshot
             ON snapshot.id = entry.snapshot_id
           WHERE entry.showcase_id = s.id
             AND snapshot.status = 'published'
             AND snapshot.evaluation_version_id = (
               SELECT latest.evaluation_version_id
               FROM result_leaderboard_snapshots latest
               INNER JOIN evaluation_versions evaluation
                 ON evaluation.id = latest.evaluation_version_id
               WHERE latest.status = 'published'
               ORDER BY evaluation.version DESC
               LIMIT 1
             )
           ORDER BY snapshot.version DESC
           LIMIT 1
         ) AS rank
       FROM showcases s
       LEFT JOIN runs r ON r.showcase_id = s.id
       LEFT JOIN benchmark_versions bv ON bv.id = s.benchmark_version_id
       LEFT JOIN result_configurations rc ON rc.id = s.result_configuration_id
       LEFT JOIN showcase_enrichments enrichment ON enrichment.showcase_id = s.id
       WHERE s.owner_id = ?
       ORDER BY s.updated_at DESC
       LIMIT 100`,
    )
      .bind(ownerId)
      .all<SubmissionRow>(),
    env.DB.prepare(
      `WITH owner_events AS (
         SELECT
           event.id AS event_id,
           s.id AS showcase_id,
           event.action,
           event.metadata_json,
           event.created_at
         FROM showcases s
         INNER JOIN audit_events event
           ON event.entity_type = 'showcase' AND event.entity_id = s.id
         WHERE s.owner_id = ?
         UNION ALL
         SELECT
           event.id AS event_id,
           r.showcase_id AS showcase_id,
           event.action,
           event.metadata_json,
           event.created_at
         FROM runs r
         INNER JOIN audit_events event
           ON event.entity_type = 'run' AND event.entity_id = r.id
         WHERE r.contributor_id = ? AND r.showcase_id IS NOT NULL
         UNION ALL
         SELECT
           event.id AS event_id,
           artifact.showcase_id AS showcase_id,
           event.action,
           event.metadata_json,
           event.created_at
         FROM artifacts artifact
         INNER JOIN showcases s ON s.id = artifact.showcase_id
         INNER JOIN audit_events event
           ON event.entity_type = 'artifact' AND event.entity_id = artifact.id
         WHERE s.owner_id = ?
         UNION ALL
         SELECT
           event.id AS event_id,
           r.showcase_id AS showcase_id,
           event.action,
           event.metadata_json,
           event.created_at
         FROM disputes dispute
         INNER JOIN runs r ON r.id = dispute.run_id
         INNER JOIN audit_events event
           ON event.entity_type = 'dispute' AND event.entity_id = dispute.id
         WHERE r.contributor_id = ? AND r.showcase_id IS NOT NULL
       ), numbered AS (
         SELECT *, row_number() OVER (
           PARTITION BY showcase_id ORDER BY created_at DESC
         ) AS event_number
         FROM owner_events
       )
       SELECT event_id, showcase_id, action, metadata_json, created_at
       FROM numbered
       WHERE event_number <= 30
       ORDER BY created_at DESC`,
    )
      .bind(ownerId, ownerId, ownerId, ownerId)
      .all<AuditRow>(),
    env.DB.prepare(
      `SELECT
         claim.id AS claim_id,
         r.showcase_id,
         claim.stage,
         claim.status,
         claim.attempt_count,
         claim.error_code,
         claim.created_at,
         claim.updated_at
       FROM run_stage_claims claim
       INNER JOIN runs r ON r.id = claim.run_id
       WHERE r.contributor_id = ? AND r.showcase_id IS NOT NULL
       ORDER BY claim.updated_at DESC
       LIMIT 500`,
    )
      .bind(ownerId)
      .all<StageRow>(),
  ]);

  const auditByShowcase = groupBy(audit.results, (row) => row.showcase_id);
  const stagesByShowcase = groupBy(stages.results, (row) => row.showcase_id);

  return submissions.results.map((row): ContributorSubmission => {
    const state = computeSubmissionState({
      showcaseStatus: row.showcase_status,
      safetyStatus: row.safety_status,
      judgeStatus: row.judge_status,
      rankingStatus: row.ranking_status,
      rank: nullableNumber(row.rank),
      runStatus: row.run_status,
      failureCode:
        row.processing_failure_code ??
        (row.benchmark_version_id ? row.run_failure_code : null),
      failureSummary:
        row.processing_failure_summary ??
        (row.benchmark_version_id ? row.run_failure_summary : null),
    });
    const timeline = [
      ...(auditByShowcase.get(row.id) ?? []).map(auditTimelineEvent),
      ...(stagesByShowcase.get(row.id) ?? []).map(stageTimelineEvent),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 30);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      benchmark: row.benchmark,
      model: row.model,
      modelVersion: row.model_version,
      harness: row.harness,
      reasoning: row.reasoning,
      scoreBps: nullableNumber(row.score_bps),
      rank: nullableNumber(row.rank),
      judgeDueAt: row.benchmark_version_id
        ? nullableIso(row.judge_due_at)
        : null,
      updatedAt: iso(row.updated_at),
      canPublish:
        row.showcase_status === "draft" &&
        row.safety_status === "approved" &&
        !row.processing_failure_code,
      state,
      timeline,
      enrichment: row.enrichment_status
        ? {
            status: row.enrichment_status,
            failureCode: row.enrichment_failure_code,
            canRetry: row.enrichment_status === "failed",
          }
        : null,
      processing: row.processing_failure_code
        ? {
            failureCode: row.processing_failure_code,
            failedAt: nullableIso(row.processing_failed_at),
            canRetry: true,
          }
        : null,
    };
  });
}

function auditTimelineEvent(row: AuditRow): SubmissionTimelineEvent {
  const metadata = parseMetadata(row.metadata_json);
  const transition = stringValue(metadata.to);
  const detail =
    row.action === "run.status_transitioned" && transition
      ? `Run moved from ${humanize(stringValue(metadata.from) ?? "unknown")} to ${humanize(transition)}.`
      : auditDetail(row.action, metadata);
  return {
    key: `audit:${row.event_id}`,
    label:
      row.action === "run.status_transitioned" && transition
        ? runStatusLabel(transition)
        : auditLabel(row.action),
    detail,
    status: auditStatus(row.action),
    occurredAt: iso(row.created_at),
  };
}

function stageTimelineEvent(row: StageRow): SubmissionTimelineEvent {
  const stage = humanize(row.stage);
  return {
    key: `stage:${row.claim_id}`,
    label: `${titleCase(stage)} stage ${humanize(row.status)}`,
    detail:
      row.status === "failed"
        ? `Attempt ${row.attempt_count} stopped${row.error_code ? `: ${humanize(row.error_code)}` : "."}`
        : `Attempt ${row.attempt_count}.`,
    status:
      row.status === "failed"
        ? "failed"
        : row.status === "completed"
          ? "completed"
          : "pending",
    occurredAt: iso(row.updated_at),
  };
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "showcase.draft_created": "Submission created",
    "showcase.published": "Test published",
    "artifact.scan_approved": "Evidence safety scan passed",
    "artifact.scan_blocked": "Evidence blocked by safety scan",
    "artifact.scan_pending": "Evidence held for safety review",
    "showcase.processing_failed": "Evidence processing failed",
    "showcase.processing_retry_completed": "Evidence processing completed",
    "showcase.processing_retry_blocked": "Evidence blocked after retry",
    "showcase.processing_retry_pending": "Evidence processing retry pending",
    "run.published": "AI review published",
    "run.ranking_refreshed": "Ranking refreshed",
    "run.pipeline_delayed": "AI review delayed",
    "run.pipeline_failed": "AI review failed",
    "run.pipeline_recovered": "AI review recovered",
    "run.evaluation_requeued": "AI evaluation requeued",
    "run.dispute_rejudge_queued": "Dispute re-review queued",
    "run.dispute_rejudge_deferred": "Dispute re-review deferred",
    "dispute.opened": "Dispute opened",
    "dispute.resolved": "Dispute resolved",
    "dispute.dismissed": "Dispute dismissed",
    "showcase.ranking_gate_recomputed": "Ranking eligibility recalculated",
  };
  return labels[action] ?? titleCase(humanize(action.replaceAll(".", " ")));
}

function auditDetail(action: string, metadata: Record<string, unknown>) {
  if (action === "run.pipeline_delayed") {
    return "Infrastructure review was delayed and will retry automatically.";
  }
  if (action === "run.pipeline_failed") {
    const stage = stringValue(metadata.stage);
    const code = stringValue(metadata.code);
    return [stage ? `${titleCase(humanize(stage))} stage` : null, code ? humanize(code) : null]
      .filter(Boolean)
      .join(": ") || null;
  }
  const reason = stringValue(metadata.reason);
  return reason ? humanize(reason) : null;
}

function auditStatus(action: string): SubmissionTimelineEvent["status"] {
  if (/failed|blocked|disqualified|removed|rejected/.test(action)) return "failed";
  if (/delayed|deferred|queued|created|drafted/.test(action)) return "pending";
  if (/published|approved|completed|recovered|refreshed/.test(action)) {
    return "completed";
  }
  return "info";
}

function runStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued_evaluation: "AI evaluation queued",
    evaluating: "AI evaluation started",
    judging: "AI judge started",
    scored: "AI review scored",
    published: "AI review published",
    evaluation_failed: "AI evaluation failed",
    disqualified: "Run disqualified",
  };
  return labels[status] ?? `Run ${humanize(status)}`;
}

function parseMetadata(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableIso(value: number | null | undefined) {
  return value === null || value === undefined ? null : iso(value);
}

function iso(value: number) {
  return new Date(Number(value)).toISOString();
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return grouped;
}
