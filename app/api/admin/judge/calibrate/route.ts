import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse } from "@/lib/http/api";
import { runJudgeCalibration } from "@/lib/judging/calibration";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    await enforceRateLimit(identity.subject, {
      action: "judge-calibration-manual",
      limit: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const calibration = await runJudgeCalibration();
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "judge-calibration",
      entityId: "manual",
      action: "judge.calibration_triggered",
      metadata: calibration,
    });
    return secureJson({ calibration });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
