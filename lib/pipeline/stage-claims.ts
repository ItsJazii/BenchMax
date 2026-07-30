import { env } from "cloudflare:workers";
import {
  createStageClaimService,
  type StageClaimRepository,
  type StoredStageClaim,
} from "./stage-claim-service";
import type { PipelineStage } from "./messages";

const repository: StageClaimRepository = {
  async tryClaim(input) {
    const row = await env.DB.prepare(
      `INSERT INTO run_stage_claims
        (id, run_id, stage, stage_version, status, attempt_count, lease_expires_at, completed_at, error_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'claimed', 1, ?, NULL, NULL, ?, ?)
       ON CONFLICT(run_id, stage, stage_version) DO UPDATE SET
         id = excluded.id,
         status = 'claimed',
         attempt_count = run_stage_claims.attempt_count + 1,
         lease_expires_at = excluded.lease_expires_at,
         completed_at = NULL,
         error_code = NULL,
         updated_at = excluded.updated_at
       WHERE run_stage_claims.status = 'failed'
          OR (run_stage_claims.status = 'claimed' AND run_stage_claims.lease_expires_at < ?)
       RETURNING id, status, attempt_count, lease_expires_at`,
    )
      .bind(
        input.claimId,
        input.runId,
        input.stage,
        input.stageVersion,
        input.leaseExpiresAt,
        input.now,
        input.now,
        input.now,
      )
      .first<{
        attempt_count: number;
        id: string;
        lease_expires_at: number;
        status: StoredStageClaim["status"];
      }>();
    return row ? fromRow(row) : null;
  },

  async find(input) {
    const row = await env.DB.prepare(
      `SELECT id, status, attempt_count, lease_expires_at
       FROM run_stage_claims
       WHERE run_id = ? AND stage = ? AND stage_version = ?
       LIMIT 1`,
    )
      .bind(input.runId, input.stage, input.stageVersion)
      .first<{
        attempt_count: number;
        id: string;
        lease_expires_at: number;
        status: StoredStageClaim["status"];
      }>();
    return row ? fromRow(row) : null;
  },

  async complete(input) {
    const result = await env.DB.prepare(
      `UPDATE run_stage_claims
       SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ?
         AND status = 'claimed'
         AND lease_expires_at >= ?`,
    )
      .bind(input.now, input.now, input.claimId, input.now)
      .run();
    return result.meta.changes === 1;
  },

  async fail(input) {
    const result = await env.DB.prepare(
      `UPDATE run_stage_claims
       SET status = 'failed', error_code = ?, updated_at = ?
       WHERE id = ?
         AND status = 'claimed'
         AND lease_expires_at >= ?`,
    )
      .bind(input.errorCode, input.now, input.claimId, input.now)
      .run();
    return result.meta.changes === 1;
  },
};

const service = createStageClaimService(repository);

/**
 * Claims a pipeline stage with a D1 compare-and-swap. Reclaims receive a new
 * claim id, so an expired holder cannot complete the replacement lease.
 */
export async function claimStage(input: {
  runId: string;
  stage: PipelineStage;
  stageVersion: string;
}) {
  return service.claim(input);
}

export async function completeStage(claimId: string) {
  return service.complete(claimId);
}

export async function failStage(claimId: string, errorCode: string) {
  return service.fail(claimId, errorCode);
}

function fromRow(row: {
  attempt_count: number;
  id: string;
  lease_expires_at: number;
  status: StoredStageClaim["status"];
}): StoredStageClaim {
  return {
    attemptCount: Number(row.attempt_count),
    id: row.id,
    leaseExpiresAt: Number(row.lease_expires_at),
    status: row.status,
  };
}

export { StageClaimLostError } from "./stage-claim-service";
