import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { evaluationVersions } from "@/db/schema";
import { appendAuditEvent } from "@/lib/data/audit";
import { sha256Hex } from "@/lib/security/policy";
import { canonicalJson } from "@/lib/security/canonical";
import {
  callPinnedJudge,
  judgeCalibrationDisposition,
} from "./provider";
import {
  createJudgeOutputSchema,
  evidenceSufficiencyConsensus,
  JUDGE_EVIDENCE_SUFFICIENCY_RULE,
  median,
} from "./protocol";
import { meanAbsoluteDriftBps } from "./calibration-math";

const calibrationSetSchema = z
  .object({
    version: z.literal(1),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            benchmark: z.string().min(20).max(20_000),
            rubric: z
              .array(
                z
                  .object({
                    key: z.string().min(1).max(80),
                    description: z.string().min(5).max(500),
                    expectedScoreBps: z.number().int().min(0).max(10_000),
                  })
                  .strict(),
              )
              .min(1)
              .max(12),
            evidence: z.string().min(10).max(100_000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

export async function runJudgeCalibration() {
  const [evaluation] = await getDb()
    .select()
    .from(evaluationVersions)
    .where(inArray(evaluationVersions.status, ["draft", "active"]))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  if (!evaluation) return { status: "no-active-evaluation" as const };
  if (evaluation.status !== "draft" && evaluation.status !== "active") {
    return { status: "no-active-evaluation" as const };
  }
  try {
  const disposition = judgeCalibrationDisposition({
    modelVersion: evaluation.judgeModelVersion,
    provider: evaluation.judgeProvider,
    status: evaluation.status,
  });
  if (disposition === "freeze") {
    await freezeEvaluation(evaluation.id, "mutable_model_alias", {
      judgeModelVersion: evaluation.judgeModelVersion,
      judgeProvider: evaluation.judgeProvider,
    });
    return { status: "frozen" as const, reason: "mutable_model_alias" as const };
  }
  const objectKey = requiredValue("JUDGE_CALIBRATION_SET_OBJECT_KEY");
  const object = await env.UPLOADS.get(objectKey);
  if (!object) throw new CalibrationConfigurationError("set_missing");
  const bytes = await object.arrayBuffer();
  const digest = await sha256Hex(bytes);
  if (digest !== evaluation.calibrationSetHash) {
    await freezeEvaluation(evaluation.id, "calibration_set_hash_mismatch", {
      expectedHash: evaluation.calibrationSetHash,
      actualHash: digest,
    });
    return { status: "frozen" as const, reason: "set_hash_mismatch" };
  }
  const set = calibrationSetSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const scorePairs: Array<{ actual: number; expected: number }> = [];
  for (const item of set.items) {
    const keys = item.rubric.map((dimension) => dimension.key);
    const outputSchema = createJudgeOutputSchema(keys);
    const outputs = [];
    const prompt = `${evaluation.promptTemplate}\n\n${canonicalJson({
      calibration: true,
      benchmark: item.benchmark,
      evidenceGate: {
        rule: JUDGE_EVIDENCE_SUFFICIENCY_RULE,
        requiredOutput: {
          evidence_sufficient: "boolean",
          evidence_sufficiency_reason: "concise reason",
        },
      },
      rubric: item.rubric.map(({ key, description }) => ({
        key,
        description,
      })),
      untrustedEvidence: `UNTRUSTED_EVIDENCE_START\n${item.evidence}\nUNTRUSTED_EVIDENCE_END`,
    })}`;
    for (let index = 0; index < 3; index += 1) {
      const response = await callPinnedJudge({
        endpointOrigin: evaluation.endpointOrigin,
        maxTokens: evaluation.maxTokensPerSample,
        model: evaluation.judgeModelVersion,
        prompt,
        provider: evaluation.judgeProvider,
        images: [],
      });
      outputs.push(outputSchema.parse(JSON.parse(response.content)));
    }
    if (
      !evidenceSufficiencyConsensus(
        outputs.map((output) => ({
          evidenceSufficient: output.evidence_sufficient,
        })),
      )
    ) {
      throw new CalibrationConfigurationError(
        "calibration_evidence_insufficient",
      );
    }
    for (const dimension of item.rubric) {
      const actual = median(
        outputs.map(
          (output) =>
            output.dimensions.find((score) => score.key === dimension.key)!
              .score_bps,
        ),
      );
      scorePairs.push({
        actual,
        expected: dimension.expectedScoreBps,
      });
    }
  }
  const driftBps = meanAbsoluteDriftBps(scorePairs);
  if (driftBps > evaluation.driftThresholdBps) {
    await freezeEvaluation(evaluation.id, "calibration_drift", {
      meanAbsoluteDriftBps: driftBps,
      thresholdBps: evaluation.driftThresholdBps,
    });
    return {
      status: "frozen" as const,
      reason: "calibration_drift",
      meanAbsoluteDriftBps: driftBps,
    };
  }
  const shouldActivate = disposition === "activate";
  const priorActiveIds = shouldActivate
    ? await activateCalibratedDraft(evaluation.id)
    : [];
  if (disposition === "candidate-only") {
    await holdCalibratedCandidate(evaluation.id);
  }
  let action = "judge.calibration_candidate_passed";
  let status: "activated" | "candidate-passed" | "passed" = "candidate-passed";
  if (evaluation.status === "active") {
    action = "judge.calibration_passed";
    status = "passed";
  } else if (shouldActivate) {
    action = "judge.calibration_activated";
    status = "activated";
  }
  await appendAuditEvent({
    actorUserId: null,
    entityType: "evaluation-version",
    entityId: evaluation.id,
    action,
    metadata: {
      activationBlockedReason:
        disposition === "candidate-only" ? "mutable_model_alias" : null,
      itemCount: set.items.length,
      meanAbsoluteDriftBps: driftBps,
      priorActiveIds,
      thresholdBps: evaluation.driftThresholdBps,
    },
  });
  return {
    status,
    meanAbsoluteDriftBps: driftBps,
  };
  } catch (error) {
    await freezeEvaluation(
      evaluation.id,
      "calibration_execution_failed",
      { errorCode: calibrationErrorCode(error) },
    );
    return {
      status: "frozen" as const,
      reason: "calibration_execution_failed" as const,
    };
  }
}

async function holdCalibratedCandidate(evaluationVersionId: string) {
  const db = getDb();
  await db
    .update(evaluationVersions)
    .set({ status: "retired", updatedAt: new Date() })
    .where(
      and(
        eq(evaluationVersions.id, evaluationVersionId),
        eq(evaluationVersions.status, "draft"),
      ),
    );
  const [held] = await db
    .select({ status: evaluationVersions.status })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.id, evaluationVersionId))
    .limit(1);
  if (held?.status !== "retired") {
    throw new CalibrationConfigurationError("candidate_hold_race");
  }
}

async function activateCalibratedDraft(evaluationVersionId: string) {
  const priorActive = await getDb()
    .select({ id: evaluationVersions.id })
    .from(evaluationVersions)
    .where(
      and(
        eq(evaluationVersions.status, "active"),
        ne(evaluationVersions.id, evaluationVersionId),
      ),
    );
  const now = new Date();
  const db = getDb();
  await db.batch([
    db
      .update(evaluationVersions)
      .set({ status: "frozen", updatedAt: now })
      .where(
        and(
          eq(evaluationVersions.status, "active"),
          ne(evaluationVersions.id, evaluationVersionId),
        ),
      ),
    db
      .update(evaluationVersions)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(evaluationVersions.id, evaluationVersionId),
          eq(evaluationVersions.status, "draft"),
        ),
      ),
  ]);
  const [activated] = await db
    .select({ status: evaluationVersions.status })
    .from(evaluationVersions)
    .where(eq(evaluationVersions.id, evaluationVersionId))
    .limit(1);
  if (activated?.status !== "active") {
    throw new CalibrationConfigurationError("activation_race");
  }
  return priorActive.map((item) => item.id);
}

async function freezeEvaluation(
  evaluationVersionId: string,
  reason: string,
  metadata: Record<string, unknown>,
) {
  await getDb()
    .update(evaluationVersions)
    .set({ status: "frozen", updatedAt: new Date() })
    .where(
      eq(evaluationVersions.id, evaluationVersionId),
    );
  await appendAuditEvent({
    actorUserId: null,
    entityType: "evaluation-version",
    entityId: evaluationVersionId,
    action: "judge.calibration_frozen",
    metadata: { reason, ...metadata },
  });
  emitCriticalCalibrationAlert({
    evaluationVersionId,
    metadata,
    reason,
  });
}

function emitCriticalCalibrationAlert(input: {
  evaluationVersionId: string;
  metadata: Record<string, unknown>;
  reason: string;
}) {
  // Cloudflare Workers captures console errors as operational error events.
  // The structured event is intentionally credential-free so production
  // alerting can route it without exposing judge or calibration material.
  console.error(
    canonicalJson({
      alert: "judge_calibration_frozen",
      evaluationVersionId: input.evaluationVersionId,
      metadata: input.metadata,
      reason: input.reason,
      severity: "critical",
    }),
  );
}

function requiredValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 500) {
    throw new CalibrationConfigurationError("configuration_missing");
  }
  return value;
}

function calibrationErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_:-]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error
    ? error.name
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .slice(0, 80)
    : "unknown_error";
}

export class CalibrationConfigurationError extends Error {
  constructor(readonly code: string) {
    super("Judge calibration is not configured.");
    this.name = "CalibrationConfigurationError";
  }
}
