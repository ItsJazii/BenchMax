import { z } from "zod";
import { requireAuthorizedUser, requireRole } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import { grantCredits } from "@/lib/data/credits";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const grantSchema = z
  .object({
    userId: z.string().uuid(),
    amountMilliCredits: z.number().int().positive().max(10_000_000),
    reason: z.string().trim().min(10).max(500),
    idempotencyKey: z.string().trim().min(12).max(120),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const { identity, user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    await enforceRateLimit(identity.subject, {
      action: "credit-admin-grant",
      limit: 50,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = await parseJson(request, grantSchema);
    await grantCredits({
      actorUserId: user.id,
      userId: input.userId,
      amountMilliCredits: input.amountMilliCredits,
      idempotencyKey: input.idempotencyKey,
      metadata: { reason: input.reason },
    });
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "credit_ledger",
      entityId: input.idempotencyKey,
      action: "credit.admin_granted",
      metadata: {
        targetUserId: input.userId,
        amountMilliCredits: input.amountMilliCredits,
        reason: input.reason,
      },
    });
    return secureJson({ granted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
