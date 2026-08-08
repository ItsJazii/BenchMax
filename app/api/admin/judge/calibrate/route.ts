import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse } from "@/lib/http/api";
import { runJudgeCalibration } from "@/lib/judging/calibration";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getRequestExecutionContext } from "vinext/shims/request-context";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    const executionContext = getRequestExecutionContext();
    if (!executionContext) throw new CalibrationDispatchUnavailableError();
    await enforceRateLimit(identity.subject, {
      action: "judge-calibration-manual",
      limit: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "judge-calibration",
      entityId: "manual",
      action: "judge.calibration_triggered",
      metadata: { status: "started" },
    });
    executionContext.waitUntil(runManualCalibration(user.id));
    return secureJson(
      { calibration: { status: "started" as const } },
      { status: 202 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function runManualCalibration(actorUserId: string) {
  try {
    const calibration = await runJudgeCalibration();
    await appendAuditEvent({
      actorUserId,
      entityType: "judge-calibration",
      entityId: "manual",
      action: "judge.calibration_completed",
      metadata: calibration,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Benchmax manual calibration background task failed", {
      name: errorName,
    });
    await appendAuditEvent({
      actorUserId,
      entityType: "judge-calibration",
      entityId: "manual",
      action: "judge.calibration_background_failed",
      metadata: { errorName },
    });
  }
}

class CalibrationDispatchUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super("Background calibration is unavailable.");
    this.name = "CalibrationDispatchUnavailableError";
  }
}
