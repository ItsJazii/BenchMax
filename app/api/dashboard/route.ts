import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { listRunsForOwner } from "@/lib/data/runs";
import { listShowcasesForOwner } from "@/lib/data/showcases";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    const [runs, showcases] = await Promise.all([
      listRunsForOwner(user.id),
      listShowcasesForOwner(user.id),
    ]);
    return secureJson({
      dashboard: {
        profile: {
          displayName: user.displayName,
          handle: user.handle,
          role: user.role,
        },
        runs,
        showcases,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
