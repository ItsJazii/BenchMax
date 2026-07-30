import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { evaluationVersions } from "@/db/schema";
import { appendAuditEvent } from "@/lib/data/audit";
import { sha256Hex } from "@/lib/security/policy";
import { canonicalJson } from "@/lib/security/canonical";
import { callPinnedJudge } from "./judge-run";
import { createJudgeOutputSchema, median } from "./protocol";
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
    .where(eq(evaluationVersions.status, "active"))
    .orderBy(desc(evaluationVersions.version))
    .limit(1);
  if (!evaluation) return { status: "no-active-evaluation" as const };
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
        model: evaluation.judgeModel,
        prompt,
        screenshot: null,
      });
      outputs.push(outputSchema.parse(JSON.parse(response.content)));
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
  await appendAuditEvent({
    actorUserId: null,
    entityType: "evaluation-version",
    entityId: evaluation.id,
    action: "judge.calibration_passed",
    metadata: {
      itemCount: set.items.length,
      meanAbsoluteDriftBps: driftBps,
      thresholdBps: evaluation.driftThresholdBps,
    },
  });
  return { status: "passed" as const, meanAbsoluteDriftBps: driftBps };
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

export class CalibrationConfigurationError extends Error {
  constructor(readonly code: string) {
    super("Judge calibration is not configured.");
    this.name = "CalibrationConfigurationError";
  }
}
