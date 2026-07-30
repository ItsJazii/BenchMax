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
  stageClaimDisposition,
} from "../lib/pipeline/recovery";
import { processPipelineDeadLetter } from "../lib/pipeline/dead-letter";
import { isAllowedRunTransition } from "../lib/security/run-policy";
import type { PipelineMessage, PipelineStage } from "../lib/pipeline/messages";
import type { RunStatus } from "../lib/security/run-policy";

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
  assert.equal(isAllowedRunTransition("scored", "evaluation_failed"), true);
  assert.equal(isAllowedRunTransition("published", "scored"), false);
  assert.equal(isAllowedRunTransition("published", "evaluation_failed"), false);
});

test("stalled-run stage selection advances past a completed evaluation", () => {
  assert.equal(
    recoveryStageForRun({ status: "queued_generation" }),
    "generate-platform",
  );
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
});

test("sweeper re-enqueues each stalled run on the correct queue", async () => {
  const candidates: Array<{
    completed_evaluate: number;
    completed_publish: number;
    run_id: string;
    status: RunStatus;
  }> = [
    candidate("run-generate", "generating"),
    candidate("run-evaluate", "queued_evaluation"),
    candidate("run-evaluate-complete", "queued_evaluation", {
      completedEvaluate: true,
    }),
    candidate("run-judge", "evaluating", { completedEvaluate: true }),
    candidate("run-publish", "scored"),
    candidate("run-published", "scored", { completedPublish: true }),
    candidate("run-generated", "generated"),
  ];
  const updates: Array<{ args: unknown[]; query: string }> = [];
  const db = {
    prepare(query: string) {
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
    generatePlatform: [] as PipelineMessage[],
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
      generatePlatform: queue("generatePlatform"),
      judge: queue("judge"),
    },
  });

  assert.deepEqual(sent.generatePlatform.map(summary), [
    "run-generate:generate-platform",
  ]);
  assert.deepEqual(sent.evaluate.map(summary), [
    "run-evaluate:evaluate",
    "run-generated:evaluate",
  ]);
  assert.deepEqual(sent.judge.map(summary), [
    "run-evaluate-complete:judge",
    "run-judge:judge",
    "run-publish:publish",
  ]);
  assert.equal(recovered.length, 6);
  assert.ok(
    updates.some(
      ({ args, query }) =>
        query.includes("status = 'queued_evaluation'") &&
        args.includes("run-generated"),
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
    [
      "run-evaluate-complete:queued_evaluation:evaluating:judge",
      "run-generated:generated:queued_evaluation:evaluate",
    ],
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
    completedEvaluate?: boolean;
    completedPublish?: boolean;
  } = {},
) {
  return {
    completed_evaluate: Number(options.completedEvaluate ?? false),
    completed_publish: Number(options.completedPublish ?? false),
    run_id: runId,
    status,
  };
}

function summary(message: PipelineMessage) {
  return `${message.runId}:${message.stage}`;
}
