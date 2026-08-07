import assert from "node:assert/strict";
import test from "node:test";
import {
  createStageClaimService,
  type StageClaimRepository,
  type StoredStageClaim,
} from "../lib/pipeline/stage-claim-service";
import {
  leaseRetryDelaySeconds,
  manualRetryPlan,
  recoverStalledPipelineRuns,
  recoveryStageForRun,
  shouldDelayCommunityPipelineFailure,
  stageClaimDisposition,
} from "../lib/pipeline/recovery";
import {
  isPipelineDeadLetterQueue,
  PIPELINE_DLQ_AUDIT_INTERVAL_MS,
  planPipelineDlqAudit,
  processPipelineDeadLetter,
} from "../lib/pipeline/dead-letter";
import { isAllowedRunTransition } from "../lib/security/run-policy";
import {
  isPipelineStageVersion,
  type PipelineMessage,
  type PipelineStage,
} from "../lib/pipeline/messages";
import {
  MODERATOR_REJUDGE_STAGE_VERSION,
  TOP_TEN_ESCALATION_STAGE_VERSION,
} from "../lib/pipeline/judge-dispatch";
import type { RunStatus } from "../lib/security/run-policy";
import {
  communityJudgeDeadline,
  formatDeterministicRunId,
  initialCommunityRunStatus,
  REPAIRABLE_COMMUNITY_RUN_STATUSES,
  selectResultDispatchAction,
} from "../lib/pipeline/result-dispatch";

test("dead-letter routing recognizes every environment's DLQ name", () => {
  assert.equal(isPipelineDeadLetterQueue("benchmax-pipeline-dlq"), true);
  assert.equal(isPipelineDeadLetterQueue("benchmax-staging-pipeline-dlq"), true);
  assert.equal(isPipelineDeadLetterQueue("benchmax-evaluate"), false);
  assert.equal(isPipelineDeadLetterQueue("benchmax-staging-judge"), false);
});

test("DLQ depth audits emit on open, growth, reminder, and clear transitions", () => {
  const now = Date.parse("2026-08-07T00:00:00.000Z");
  const oldestMessageTimestamp = new Date(now - 60_000);
  assert.equal(
    planPipelineDlqAudit({
      metrics: { backlogBytes: 0, backlogCount: 0 },
      now,
      previous: null,
    }),
    null,
  );
  const opened = planPipelineDlqAudit({
    metrics: { backlogBytes: 512, backlogCount: 2, oldestMessageTimestamp },
    now,
    previous: null,
  });
  assert.deepEqual(opened, {
    action: "operations.pipeline_dlq_nonempty",
    metadata: {
      backlogBytes: 512,
      backlogCount: 2,
      oldestMessageTimestamp: oldestMessageTimestamp.toISOString(),
      observedAt: new Date(now).toISOString(),
      reason: "opened",
    },
  });
  const previous = { backlogCount: 2, createdAt: now };
  assert.equal(
    planPipelineDlqAudit({
      metrics: { backlogBytes: 512, backlogCount: 2, oldestMessageTimestamp },
      now: now + PIPELINE_DLQ_AUDIT_INTERVAL_MS - 1,
      previous,
    }),
    null,
  );
  assert.equal(
    planPipelineDlqAudit({
      metrics: { backlogBytes: 768, backlogCount: 3, oldestMessageTimestamp },
      now: now + 1,
      previous,
    })?.metadata.reason,
    "grew",
  );
  assert.equal(
    planPipelineDlqAudit({
      metrics: { backlogBytes: 512, backlogCount: 2, oldestMessageTimestamp },
      now: now + PIPELINE_DLQ_AUDIT_INTERVAL_MS,
      previous,
    })?.metadata.reason,
    "reminder",
  );
  assert.deepEqual(
    planPipelineDlqAudit({
      metrics: { backlogBytes: 0, backlogCount: 0 },
      now: now + 1,
      previous,
    }),
    {
      action: "operations.pipeline_dlq_cleared",
      metadata: {
        backlogBytes: 0,
        backlogCount: 0,
        oldestMessageTimestamp: null,
        observedAt: new Date(now + 1).toISOString(),
        reason: "cleared",
      },
    },
  );
});

test("pipeline stage versions accept bounded refresh idempotency tokens", () => {
  assert.equal(
    isPipelineStageVersion(`catalog-approved-${crypto.randomUUID()}`),
    true,
  );
  assert.equal(
    isPipelineStageVersion(
      `ranking-catalog-approved-${crypto.randomUUID()}`,
    ),
    true,
  );
  assert.equal(isPipelineStageVersion("x".repeat(129)), false);
  assert.equal(isPipelineStageVersion("invalid stage"), false);
});

class MemoryStageClaimRepository implements StageClaimRepository {
  private readonly rows = new Map<string, StoredStageClaim>();

  async tryClaim(input: {
    claimId: string;
    leaseExpiresAt: number;
    now: number;
    runId: string;
    stage: PipelineStage;
    stageVersion: string;
  }) {
    const key = this.key(input);
    const existing = this.rows.get(key);
    if (
      existing &&
      existing.status !== "failed" &&
      !(existing.status === "claimed" && existing.leaseExpiresAt < input.now)
    ) {
      return null;
    }
    const claimed: StoredStageClaim = {
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      id: input.claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      status: "claimed",
    };
    this.rows.set(key, claimed);
    return { ...claimed };
  }

  async find(input: {
    runId: string;
    stage: PipelineStage;
    stageVersion: string;
  }) {
    const row = this.rows.get(this.key(input));
    return row ? { ...row } : null;
  }

  async complete(input: { claimId: string; now: number }) {
    const row = this.findById(input.claimId);
    if (
      !row ||
      row.value.status !== "claimed" ||
      row.value.leaseExpiresAt < input.now
    ) {
      return false;
    }
    row.value.status = "completed";
    this.rows.set(row.key, row.value);
    return true;
  }

  async fail(input: {
    claimId: string;
    errorCode: string;
    now: number;
  }) {
    void input.errorCode;
    const row = this.findById(input.claimId);
    if (
      !row ||
      row.value.status !== "claimed" ||
      row.value.leaseExpiresAt < input.now
    ) {
      return false;
    }
    row.value.status = "failed";
    this.rows.set(row.key, row.value);
    return true;
  }

  private findById(id: string) {
    for (const [key, value] of this.rows) {
      if (value.id === id) return { key, value: { ...value } };
    }
    return null;
  }

  private key(input: {
    runId: string;
    stage: PipelineStage;
    stageVersion: string;
  }) {
    return `${input.runId}:${input.stage}:${input.stageVersion}`;
  }
}

test("busy stage claims retry, completed duplicates ack, and reclaims rotate identity", async () => {
  let now = 1_000;
  let sequence = 0;
  const service = createStageClaimService(new MemoryStageClaimRepository(), {
    now: () => now,
    randomUUID: () => `claim-${++sequence}`,
  });
  const input = {
    runId: "11111111-1111-4111-8111-111111111111",
    stage: "evaluate" as const,
    stageVersion: "1",
  };

  const first = await service.claim(input);
  assert.deepEqual(first, {
    attemptCount: 1,
    id: "claim-1",
    status: "claimed",
  });

  now = 2_000;
  const busy = await service.claim(input);
  assert.equal(busy.status, "busy");
  if (busy.status !== "busy") assert.fail("claim should remain leased");
  assert.equal(leaseRetryDelaySeconds(busy.leaseExpiresAt, now), 299);
  assert.deepEqual(stageClaimDisposition(busy, now), {
    action: "retry",
    delaySeconds: 299,
  });

  now = 301_001;
  const reclaimed = await service.claim(input);
  assert.deepEqual(reclaimed, {
    attemptCount: 2,
    id: "claim-3",
    status: "claimed",
  });
  await assert.rejects(() => service.complete("claim-1"), {
    name: "StageClaimLostError",
  });
  await service.complete("claim-3");

  const duplicate = await service.claim(input);
  assert.deepEqual(duplicate, { status: "completed" });
  assert.deepEqual(stageClaimDisposition(duplicate, now), { action: "ack" });
});

test("failed three-sample judge stage versions can be re-enqueued", async () => {
  let now = 1_000;
  let sequence = 0;
  const service = createStageClaimService(new MemoryStageClaimRepository(), {
    now: () => now,
    randomUUID: () => `claim-${++sequence}`,
  });
  for (const [index, stageVersion] of [
    TOP_TEN_ESCALATION_STAGE_VERSION,
    MODERATOR_REJUDGE_STAGE_VERSION,
  ].entries()) {
    const input = {
      runId: `11111111-1111-4111-8111-11111111111${index}`,
      stage: "judge" as const,
      stageVersion,
    };
    const claimed = await service.claim(input);
    if (claimed.status !== "claimed") assert.fail("stage should be claimed");
    await service.fail(claimed.id, "judge_unavailable");
    now += 1;
    const requeued = await service.claim(input);
    assert.equal(requeued.status, "claimed");
    if (requeued.status !== "claimed") assert.fail("stage should re-open");
    assert.equal(requeued.attemptCount, 2);
  }
});

test("manual recovery resumes the failed evaluate, judge, or publish stage", () => {
  assert.deepEqual(manualRetryPlan("evaluate"), {
    queue: "evaluate",
    stage: "evaluate",
    targetStatus: "queued_evaluation",
  });
  assert.deepEqual(manualRetryPlan("judge"), {
    queue: "judge",
    stage: "judge",
    targetStatus: "judging",
  });
  assert.deepEqual(manualRetryPlan("publish"), {
    queue: "judge",
    stage: "publish",
    targetStatus: "scored",
  });
  assert.deepEqual(manualRetryPlan("judge", { alreadyScored: true }), {
    queue: "judge",
    stage: "publish",
    targetStatus: "scored",
  });
  assert.equal(
    isAllowedRunTransition("evaluation_failed", "queued_evaluation"),
    true,
  );
  assert.equal(isAllowedRunTransition("evaluation_failed", "judging"), true);
  assert.equal(isAllowedRunTransition("evaluation_failed", "scored"), true);
  assert.equal(isAllowedRunTransition("queued_evaluation", "judging"), true);
  assert.equal(isAllowedRunTransition("scored", "evaluation_failed"), true);
  assert.equal(isAllowedRunTransition("published", "scored"), false);
  assert.equal(isAllowedRunTransition("published", "evaluation_failed"), false);
});

test("community result dispatch is repairable without regressing progressed runs", () => {
  assert.deepEqual(REPAIRABLE_COMMUNITY_RUN_STATUSES, [
    "queued_evaluation",
    "evaluating",
    "judging",
  ]);
  assert.equal(initialCommunityRunStatus(true), "queued_evaluation");
  assert.equal(initialCommunityRunStatus(false), "judging");
  assert.equal(
    selectResultDispatchAction({
      requiresEvaluation: true,
      status: "queued_evaluation",
    }),
    "evaluate",
  );
  assert.equal(
    selectResultDispatchAction({
      requiresEvaluation: true,
      status: "evaluating",
    }),
    "evaluate",
  );
  for (const status of ["queued_evaluation", "evaluating"]) {
    assert.equal(
      selectResultDispatchAction({
        requiresEvaluation: false,
        status,
      }),
      "move-to-judge",
    );
  }
  assert.equal(
    selectResultDispatchAction({
      requiresEvaluation: false,
      status: "judging",
    }),
    "judge",
  );
  for (const status of [
    "scored",
    "published",
    "evaluation_failed",
    "disqualified",
  ]) {
    assert.equal(
      selectResultDispatchAction({
        requiresEvaluation: false,
        status,
      }),
      "none",
    );
  }
});

test("deterministic community run IDs remain valid pipeline message IDs", () => {
  const digest = "0123456789abcdef".repeat(4);
  const runId = formatDeterministicRunId(digest);
  assert.equal(runId, "01234567-89ab-cdef-0123-456789abcdef");
  assert.match(runId, /^[0-9a-f-]{36}$/u);
  assert.equal(formatDeterministicRunId(digest), runId);
  assert.throws(() => formatDeterministicRunId("not-a-sha256"));
});

test("community judge deadline remains anchored to publication during repair", () => {
  const publishedAt = new Date("2026-07-31T00:00:00.000Z");
  const repairedAt = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(
    communityJudgeDeadline(publishedAt, repairedAt).toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
  assert.equal(
    communityJudgeDeadline(null, repairedAt).toISOString(),
    "2026-08-03T12:00:00.000Z",
  );
  assert.equal(
    communityJudgeDeadline(new Date(Number.NaN), repairedAt).toISOString(),
    "2026-08-03T12:00:00.000Z",
  );
});

test("stalled-run stage selection advances past a completed evaluation", () => {
  assert.equal(recoveryStageForRun({ status: "evaluating" }), "evaluate");
  assert.equal(
    recoveryStageForRun({
      completedEvaluate: true,
      status: "evaluating",
    }),
    "judge",
  );
  assert.equal(recoveryStageForRun({ status: "judging" }), "judge");
  assert.equal(recoveryStageForRun({ status: "scored" }), "publish");
  assert.equal(
    recoveryStageForRun({ completedPublish: true, status: "scored" }),
    null,
  );
  assert.equal(recoveryStageForRun({ status: "published" }), null);
  assert.equal(recoveryStageForRun({ status: "generated" }), null);
});

test("community infrastructure failures remain active for scheduled recovery", () => {
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "community-submission",
      showcaseId: "showcase-1",
      stage: "evaluate",
      status: "evaluating",
    }),
    true,
  );
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "community-submission",
      showcaseId: "showcase-1",
      stage: "judge",
      status: "judging",
    }),
    true,
  );
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "community-submission",
      showcaseId: "showcase-1",
      stage: "publish",
      status: "scored",
    }),
    true,
  );
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "community-submission",
      showcaseId: "showcase-1",
      stage: "judge",
      status: "published",
    }),
    true,
  );
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "legacy-provider",
      showcaseId: null,
      stage: "judge",
      status: "judging",
    }),
    false,
  );
  assert.equal(
    shouldDelayCommunityPipelineFailure({
      credentialMode: "community-submission",
      showcaseId: "showcase-1",
      stage: "evaluate",
      status: "published",
    }),
    false,
  );
});

test("sweeper re-enqueues each stalled run on the correct queue", async () => {
  const candidates: Array<{
    completed_evaluate: number;
    completed_publish: number;
    initial_budget_reserved: number;
    run_id: string;
    status: RunStatus;
  }> = [
    candidate("run-evaluate", "queued_evaluation"),
    candidate("run-evaluate-complete", "queued_evaluation", {
      completedEvaluate: true,
    }),
    candidate("run-judge", "evaluating", { completedEvaluate: true }),
    candidate("run-publish", "scored"),
    candidate("run-published", "scored", { completedPublish: true }),
    candidate("run-budget-deferred", "judging", { budgetReserved: false }),
    candidate("run-generated", "generated"),
  ];
  const updates: Array<{ args: unknown[]; query: string }> = [];
  const preparedQueries: string[] = [];
  const db = {
    prepare(query: string) {
      preparedQueries.push(query);
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              return { results: candidates, success: true };
            },
            async run() {
              updates.push({ args, query });
              return {
                meta: { changes: 1 },
                success: true,
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const sent = {
    evaluate: [] as PipelineMessage[],
    judge: [] as PipelineMessage[],
  };
  const queue = (target: keyof typeof sent) => ({
    async send(message: PipelineMessage) {
      sent[target].push(message);
    },
  });

  const recovered = await recoverStalledPipelineRuns({
    async auditTransition(transition) {
      updates.push({
        args: [transition.runId, transition.from, transition.to, transition.stage],
        query: "AUDIT TRANSITION",
      });
    },
    db,
    now: 1_000_000,
    queues: {
      evaluate: queue("evaluate"),
      judge: queue("judge"),
    },
  });

  assert.deepEqual(sent.evaluate.map(summary), ["run-evaluate:evaluate"]);
  assert.ok(
    preparedQueries.some((query) =>
      query.includes("r.credential_mode = 'community-submission'"),
    ),
  );
  assert.ok(
    preparedQueries.some((query) =>
      query.includes("budget.purpose = 'initial'"),
    ),
  );
  assert.deepEqual(sent.judge.map(summary), [
    "run-evaluate-complete:judge",
    "run-judge:judge",
    "run-publish:publish",
  ]);
  assert.equal(recovered.length, 4);
  assert.ok(
    updates.every(
      ({ args }) =>
        !args.includes("run-generated") &&
        !args.includes("run-budget-deferred"),
    ),
  );
  assert.ok(
    updates.some(
      ({ args, query }) =>
        query.includes("status = 'evaluating'") &&
        args.includes("run-evaluate-complete"),
    ),
  );
  assert.deepEqual(
    updates
      .filter(({ query }) => query === "AUDIT TRANSITION")
      .map(({ args }) => args.join(":")),
    ["run-evaluate-complete:queued_evaluation:evaluating:judge"],
  );
});

test("DLQ processing marks the run failed before recording the audit", async () => {
  const calls: string[] = [];
  const message: PipelineMessage = {
    runId: "22222222-2222-4222-8222-222222222222",
    stage: "publish",
    stageVersion: "1",
  };
  await processPipelineDeadLetter(message, {
    async getRunStatus() {
      return "scored";
    },
    async markFailed(input) {
      calls.push(`failed:${input.runId}:${input.stage}:${input.code}`);
    },
    async audit(input) {
      calls.push(
        `audit:${input.entityId}:${String(input.metadata.stage)}:${input.action}`,
      );
    },
  });
  assert.deepEqual(calls, [
    "failed:22222222-2222-4222-8222-222222222222:publish:pipeline_dead_lettered",
    "audit:22222222-2222-4222-8222-222222222222:publish:run.pipeline_dead_lettered",
  ]);
});

test("DLQ processing ignores a stale message after the run has progressed", async () => {
  const calls: string[] = [];
  const message: PipelineMessage = {
    runId: "33333333-3333-4333-8333-333333333333",
    stage: "evaluate",
    stageVersion: "1",
  };
  await processPipelineDeadLetter(message, {
    async getRunStatus() {
      return "published";
    },
    async markFailed() {
      calls.push("failed");
    },
    async audit(input) {
      calls.push(
        `${input.action}:${String(input.metadata.currentStatus)}`,
      );
    },
  });
  assert.deepEqual(calls, [
    "run.pipeline_dead_letter_ignored:published",
  ]);
});

function candidate(
  runId: string,
  status: RunStatus,
  options: {
    budgetReserved?: boolean;
    completedEvaluate?: boolean;
    completedPublish?: boolean;
  } = {},
) {
  return {
    completed_evaluate: Number(options.completedEvaluate ?? false),
    completed_publish: Number(options.completedPublish ?? false),
    initial_budget_reserved: Number(options.budgetReserved ?? true),
    run_id: runId,
    status,
  };
}

function summary(message: PipelineMessage) {
  return `${message.runId}:${message.stage}`;
}
