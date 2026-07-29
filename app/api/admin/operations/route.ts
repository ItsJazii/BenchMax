import {
  requireAuthorizedUser,
  requireRole,
} from "@/lib/auth/authorization";
import { getOperationsSnapshot } from "@/lib/data/operations";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    requireRole(user, ["owner"]);
    return secureJson({ operations: await getOperationsSnapshot() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
