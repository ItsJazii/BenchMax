import type { PipelineStage } from "./messages";

export const STAGE_LEASE_MS = 5 * 60 * 1000;

export type StoredStageClaim = {
  attemptCount: number;
  id: string;
  leaseExpiresAt: number;
  status: "claimed" | "completed" | "failed";
};

export type StageClaimResult =
  | {
      attemptCount: number;
      id: string;
      status: "claimed";
    }
  | {
      status: "completed";
    }
  | {
      leaseExpiresAt: number;
      status: "busy";
    };

export interface StageClaimRepository {
  complete(input: { claimId: string; now: number }): Promise<boolean>;
  fail(input: {
    claimId: string;
    errorCode: string;
    now: number;
  }): Promise<boolean>;
  find(input: {
    runId: string;
    stage: PipelineStage;
    stageVersion: string;
  }): Promise<StoredStageClaim | null>;
  tryClaim(input: {
    claimId: string;
    leaseExpiresAt: number;
    now: number;
    runId: string;
    stage: PipelineStage;
    stageVersion: string;
  }): Promise<StoredStageClaim | null>;
}

export function createStageClaimService(
  repository: StageClaimRepository,
  options: {
    now?: () => number;
    randomUUID?: () => string;
  } = {},
) {
  const now = options.now ?? Date.now;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  return {
    async claim(input: {
      runId: string;
      stage: PipelineStage;
      stageVersion: string;
    }): Promise<StageClaimResult> {
      const claimedAt = now();
      const row = await repository.tryClaim({
        ...input,
        claimId: randomUUID(),
        leaseExpiresAt: claimedAt + STAGE_LEASE_MS,
        now: claimedAt,
      });
      if (row) {
        return {
          attemptCount: row.attemptCount,
          id: row.id,
          status: "claimed",
        };
      }

      const existing = await repository.find(input);
      if (existing?.status === "completed") return { status: "completed" };

      return {
        leaseExpiresAt:
          existing?.status === "claimed"
            ? existing.leaseExpiresAt
            : claimedAt + 1_000,
        status: "busy",
      };
    },

    async complete(claimId: string) {
      const completed = await repository.complete({ claimId, now: now() });
      if (!completed) throw new StageClaimLostError();
    },

    async fail(claimId: string, errorCode: string) {
      return repository.fail({
        claimId,
        errorCode: safeCode(errorCode),
        now: now(),
      });
    },
  };
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
