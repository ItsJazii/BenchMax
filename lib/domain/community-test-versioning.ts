export type CommunityTestLifecycle = {
  publishedAt: Date | number | null;
  rubricStatus: "drafting" | "awaiting_approval" | "approved";
  status: "draft" | "active" | "retired";
  version: number;
};

export class CommunityTestPromptMismatchError extends Error {
  readonly status = 409;

  constructor() {
    super(
      "The submitted prompt must exactly match the selected frozen test version.",
    );
    this.name = "CommunityTestPromptMismatchError";
  }
}

export function assertSubmissionUsesFrozenTestPrompt(
  submittedPrompt: string,
  canonicalPrompt: string,
) {
  if (submittedPrompt !== canonicalPrompt) {
    throw new CommunityTestPromptMismatchError();
  }
}

/**
 * A version may be changed only while it is the creator's unpublished draft.
 * Version one uses the parent test's pre-publication state; later drafts live
 * beside already-published versions, so the parent remains active/approved.
 */
export function isEditableCommunityTestVersion(
  contract: CommunityTestLifecycle,
) {
  if (contract.publishedAt !== null) return false;
  if (contract.version === 1) {
    return (
      contract.status === "draft" &&
      contract.rubricStatus === "awaiting_approval"
    );
  }
  return (
    contract.status === "active" && contract.rubricStatus === "approved"
  );
}

export const COMMUNITY_TEST_DRAFT_OWNER_GUARD_SQL = `
  EXISTS (
    SELECT 1
    FROM benchmarks
    WHERE benchmarks.id = benchmark_versions.benchmark_id
      AND benchmarks.id = ?
      AND benchmarks.creator_id = ?
      AND (
        (benchmark_versions.version = 1
          AND benchmarks.status = 'draft'
          AND benchmarks.rubric_status = 'awaiting_approval')
        OR
        (benchmark_versions.version > 1
          AND benchmarks.status = 'active'
          AND benchmarks.rubric_status = 'approved')
      )
  )`;

/**
 * This single INSERT is the concurrency boundary for new versions. D1
 * serializes writes; the no-unpublished-draft predicate means two requests
 * that both observed v1 can never reserve v2 and v3 at the same time, while
 * the unique (benchmark_id, version) index is the final duplicate guard.
 */
export const CREATE_COMMUNITY_TEST_DRAFT_VERSION_SQL = `
  INSERT INTO benchmark_versions
    (id, benchmark_id, version, title, goal, success_criteria_json, category,
     canonical_prompt, rubric_json, harness_id, harness_contract_json,
     environment_hash, objective_weight_bps, judge_weight_bps,
     attempt_policy, attempt_count, dependency_lock_hash,
     interaction_script_hash, published_at, created_at, updated_at)
  SELECT
    ?, benchmarks.id, max(all_versions.version) + 1, ?, ?, ?, ?, ?, ?,
    source.harness_id, source.harness_contract_json, source.environment_hash,
    source.objective_weight_bps, source.judge_weight_bps,
    source.attempt_policy, source.attempt_count, source.dependency_lock_hash,
    source.interaction_script_hash, NULL, ?, ?
  FROM benchmarks
  JOIN benchmark_versions AS source
    ON source.benchmark_id = benchmarks.id
   AND source.published_at IS NOT NULL
   AND source.version = (
     SELECT max(published.version)
     FROM benchmark_versions AS published
     WHERE published.benchmark_id = benchmarks.id
       AND published.published_at IS NOT NULL
   )
  JOIN benchmark_versions AS all_versions
    ON all_versions.benchmark_id = benchmarks.id
  WHERE benchmarks.id = ?
    AND benchmarks.creator_id = ?
    AND benchmarks.status = 'active'
    AND benchmarks.rubric_status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM benchmark_versions AS draft
      WHERE draft.benchmark_id = benchmarks.id
        AND draft.published_at IS NULL
    )
  GROUP BY benchmarks.id
  RETURNING id, version`;
