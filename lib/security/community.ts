import { z } from "zod";

export const disputeCreateSchema = z
  .object({
    runId: z.string().uuid(),
    reason: z.string().trim().min(20).max(4_000),
  })
  .strict();

export const disputeResolutionSchema = z
  .object({
    status: z.enum(["resolved", "dismissed"]),
    resolution: z.string().trim().min(10).max(4_000),
  })
  .strict();

export const moderationActionSchema = z
  .object({
    entityType: z.enum(["showcase", "run", "abuse-report"]),
    entityId: z.string().uuid(),
    action: z.enum(["unpublish", "restore", "disqualify", "resolve", "dismiss"]),
    reason: z.string().trim().min(10).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    const allowedByEntity = {
      "abuse-report": ["resolve", "dismiss"],
      run: ["disqualify", "dismiss"],
      showcase: ["unpublish", "restore"],
    } as const;
    if (
      !(allowedByEntity[value.entityType] as readonly string[]).includes(
        value.action,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "That moderation action is not valid for this record type.",
        path: ["action"],
      });
    }
  });

export type ModeratableRunSnapshot = {
  injectionFlag: boolean;
  playableEnabled: boolean;
  rankEligible: boolean;
  status: string;
};

export function buildRunModerationDecision(
  record: ModeratableRunSnapshot,
  action: "dismiss" | "disqualify",
  reason: string,
) {
  if (!["scored", "published"].includes(record.status)) return null;
  if (action === "dismiss") {
    if (!record.injectionFlag) return null;
    return {
      next: {
        status: "scored",
        rankEligible: true,
        injectionFlag: false,
        playableEnabled: false,
      },
      patch: {
        injectionFlag: false as const,
        playableEnabled: false as const,
        rankEligible: true as const,
        status: "scored" as const,
      },
    };
  }
  return {
    next: {
      status: "disqualified",
      rankEligible: false,
      injectionFlag: record.injectionFlag,
      playableEnabled: false,
    },
    patch: {
      status: "disqualified" as const,
      rankEligible: false as const,
      playableEnabled: false as const,
      failureCode: "moderator_disqualified",
      failureSummary: reason.slice(0, 300),
    },
  };
}

const proposalDimensionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{2,50}$/),
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(10).max(500),
    mechanism: z.enum(["objective", "judge", "hybrid"]),
    weightBps: z.number().int().min(1).max(10_000),
    judgeSourceRequired: z.boolean(),
  })
  .strict();

export const benchmarkProposalSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    category: z.enum(["frontend", "browser-game", "browser-3d"]),
    canonicalPrompt: z.string().trim().min(50).max(40_000),
    rationale: z.string().trim().min(30).max(4_000),
    requiredOutputs: z.array(z.string().trim().min(2).max(160)).min(1).max(20),
    rubric: z.array(proposalDimensionSchema).min(2).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.rubric.map((dimension) => dimension.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Rubric keys must be unique." });
    }
    const total = value.rubric.reduce(
      (sum, dimension) => sum + dimension.weightBps,
      0,
    );
    if (total !== 10_000) {
      context.addIssue({
        code: "custom",
        message: "Rubric weights must total 10000 basis points.",
      });
    }
  });

export const proposalReviewSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(10).max(2_000),
  })
  .strict();
