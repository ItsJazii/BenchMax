import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { listModerationQueue } from "@/lib/data/community";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner", "moderator"]);
    return secureJson({ queue: await listModerationQueue() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
