import { env } from "cloudflare:workers";
import type { PipelineStage } from "./messages";

const LEASE_MS = 5 * 60 * 1000;

export type StageClaim = {
  id: string;
  attemptCount: number;
};

/**
 * Claims a pipeline stage with a D1 compare-and-swap. A completed claim can
 * never be reopened; expired and explicitly failed claims may be retried.
 */
export async function claimStage(input: {
  runId: string;
  stage: PipelineStage;
  stageVersion: string;
}): Promise<StageClaim | null> {
  const now = Date.now();
  const claimId = crypto.randomUUID();
  const row = await env.DB.prepare(
    `INSERT INTO run_stage_claims
      (id, run_id, stage, stage_version, status, attempt_count, lease_expires_at, completed_at, error_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'claimed', 1, ?, NULL, NULL, ?, ?)
     ON CONFLICT(run_id, stage, stage_version) DO UPDATE SET
       status = 'claimed',
       attempt_count = run_stage_claims.attempt_count + 1,
       lease_expires_at = excluded.lease_expires_at,
       completed_at = NULL,
       error_code = NULL,
       updated_at = excluded.updated_at
     WHERE run_stage_claims.status = 'failed'
        OR (run_stage_claims.status = 'claimed' AND run_stage_claims.lease_expires_at < ?)
     RETURNING id, attempt_count`,
  )
    .bind(
      claimId,
      input.runId,
      input.stage,
      input.stageVersion,
      now + LEASE_MS,
      now,
      now,
      now,
    )
    .first<{ id: string; attempt_count: number }>();
  if (!row) return null;
  return { id: row.id, attemptCount: Number(row.attempt_count) };
}

export async function completeStage(claimId: string) {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE run_stage_claims
     SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'claimed'`,
  )
    .bind(now, now, claimId)
    .run();
  if (result.meta.changes !== 1) {
    throw new StageClaimLostError();
  }
}

export async function failStage(claimId: string, errorCode: string) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE run_stage_claims
     SET status = 'failed', error_code = ?, updated_at = ?
     WHERE id = ? AND status = 'claimed'`,
  )
    .bind(safeCode(errorCode), now, claimId)
    .run();
}

function safeCode(value: string) {
  return /^[a-z0-9_:-]{1,80}$/.test(value)
    ? value
    : "pipeline_stage_failed";
}

export class StageClaimLostError extends Error {
  constructor() {
    super("The pipeline stage lease was lost before completion.");
    this.name = "StageClaimLostError";
  }
}
