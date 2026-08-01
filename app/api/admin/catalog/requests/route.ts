import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { models } from "@/db/schema";
import { requireAuthorizedUser, requireRole } from "@/lib/auth/authorization";
import { appendAuditEvent } from "@/lib/data/audit";
import {
  listPendingCatalogRequests,
  resolveCatalogRequest,
} from "@/lib/data/catalog-requests";
import { apiErrorResponse, parseJson } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

const decisionSchema = z
  .object({
    requestId: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    modelId: z.string().trim().min(3).max(160).optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    const [requests, modelFamilies] = await Promise.all([
      listPendingCatalogRequests(),
      getDb()
        .select({ id: models.id, name: models.name })
        .from(models)
        .where(eq(models.status, "active"))
        .orderBy(models.name),
    ]);
    return secureJson({ requests, modelFamilies });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    const input = await parseJson(request, decisionSchema);
    const result = await resolveCatalogRequest({
      ...input,
      reviewerUserId: user.id,
    });
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "catalog-request",
      entityId: input.requestId,
      action: `catalog_request.${result.status}`,
      metadata: result,
    });
    return secureJson({ result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
