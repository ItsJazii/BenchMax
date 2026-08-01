export const REPAIR_BACKOFF_BASE_MS = 2 * 60 * 1000;
export const REPAIR_BACKOFF_MAX_MS = 60 * 60 * 1000;
export const REPAIR_MAX_ATTEMPTS = 8;
const REPAIR_LEASE_MS = 5 * 60 * 1000;

export type RepairRetryDecision = "ready" | "backoff" | "exhausted";

export function repairBackoffDelayMs(attemptCount: number) {
  const normalizedAttempt = Math.max(1, Math.trunc(attemptCount));
  const exponent = Math.min(normalizedAttempt - 1, 30);
  return Math.min(
    REPAIR_BACKOFF_MAX_MS,
    REPAIR_BACKOFF_BASE_MS * 2 ** exponent,
  );
}

export function repairRetryDecision(input: {
  attemptCount: number;
  maxAttempts?: number;
  now?: number;
  updatedAt: number;
}): RepairRetryDecision {
  const attemptCount = Math.max(0, Math.trunc(input.attemptCount));
  const maxAttempts = input.maxAttempts ?? REPAIR_MAX_ATTEMPTS;
  if (attemptCount >= maxAttempts) return "exhausted";
  const now = input.now ?? Date.now();
  if (now < input.updatedAt + repairBackoffDelayMs(attemptCount)) {
    return "backoff";
  }
  return "ready";
}

export function isActiveEvaluationVersion(
  status: string | null | undefined,
): status is "active" {
  return status === "active";
}

type RepairClaimRow = {
  attempt_count: number;
  id: string;
  lease_expires_at: number;
  status: "claimed" | "completed" | "failed";
  updated_at: number;
};

export type RepairDispatchAttempt =
  | { action: "attempt"; attemptCount: number; claimId: string }
  | {
      action: "skip";
      reason: "backoff" | "busy" | "completed" | "exhausted" | "race";
    };

/**
 * Reserve one repair dispatch without claiming the actual queue execution.
 * The row intentionally remains failed until the queue consumer claims it;
 * that lets the normal stage-claim worker own completion and retries.
 */
export async function claimRepairDispatchAttempt(input: {
  db: D1Database;
  now?: number;
  runId: string;
  stageVersion: string;
}): Promise<RepairDispatchAttempt> {
  const now = input.now ?? Date.now();
  const existing = await input.db
    .prepare(
      `SELECT id, status, attempt_count, lease_expires_at, updated_at
       FROM run_stage_claims
       WHERE run_id = ? AND stage = 'judge' AND stage_version = ?
       LIMIT 1`,
    )
    .bind(input.runId, input.stageVersion)
    .first<RepairClaimRow>();

  if (existing?.status === "completed") {
    return { action: "skip", reason: "completed" };
  }
  if (existing?.status === "claimed" && existing.lease_expires_at >= now) {
    return { action: "skip", reason: "busy" };
  }
  if (existing) {
    const decision = repairRetryDecision({
      attemptCount: Number(existing.attempt_count),
      now,
      updatedAt: Number(existing.updated_at),
    });
    if (decision !== "ready") {
      return { action: "skip", reason: decision };
    }
  }

  const claimId = crypto.randomUUID();
  // This row gates dispatch only. The queue consumer increments attempt_count
  // when it actually claims execution, so dispatch must not spend an attempt.
  const attemptCount = Number(existing?.attempt_count ?? 0);
  const leaseExpiresAt = now + REPAIR_LEASE_MS;
  if (!existing) {
    const inserted = await input.db
      .prepare(
        `INSERT INTO run_stage_claims
           (id, run_id, stage, stage_version, status, attempt_count,
            lease_expires_at, completed_at, error_code, created_at, updated_at)
         VALUES (?, ?, 'judge', ?, 'failed', 0, ?, NULL,
                 'repair_dispatch_pending', ?, ?)
         ON CONFLICT(run_id, stage, stage_version) DO NOTHING`,
      )
      .bind(
        claimId,
        input.runId,
        input.stageVersion,
        leaseExpiresAt,
        now,
        now,
      )
      .run();
    if (Number(inserted.meta.changes ?? 0) !== 1) {
      return { action: "skip", reason: "race" };
    }
    return { action: "attempt", attemptCount, claimId };
  }

  const updated = await input.db
    .prepare(
      `UPDATE run_stage_claims
       SET id = ?, status = 'failed',
           lease_expires_at = ?, completed_at = NULL,
           error_code = 'repair_dispatch_pending', updated_at = ?
       WHERE id = ?
         AND attempt_count = ?
         AND updated_at = ?
         AND (
           status = 'failed'
           OR (status = 'claimed' AND lease_expires_at < ?)
         )`,
    )
    .bind(
      claimId,
      leaseExpiresAt,
      now,
      existing.id,
      existing.attempt_count,
      existing.updated_at,
      now,
    )
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) {
    return { action: "skip", reason: "race" };
  }
  return { action: "attempt", attemptCount, claimId };
}

export async function recordRepairDispatch(input: {
  claimId: string;
  db: D1Database;
  errorCode?: string;
  now?: number;
  outcome: "failed" | "queued";
}) {
  const errorCode =
    input.outcome === "queued"
      ? "repair_enqueued"
      : normalizeRepairErrorCode(input.errorCode);
  const result = await input.db
    .prepare(
      `UPDATE run_stage_claims
       SET error_code = ?, updated_at = ?
       WHERE id = ? AND status = 'failed'`,
    )
    .bind(errorCode, input.now ?? Date.now(), input.claimId)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

function normalizeRepairErrorCode(value: string | undefined) {
  return value && /^[a-z0-9_:-]{1,80}$/.test(value)
    ? value
    : "repair_dispatch_failed";
}
