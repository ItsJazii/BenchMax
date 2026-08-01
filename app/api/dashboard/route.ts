import { requireAuthorizedUser } from "@/lib/auth/authorization";
import { getContributorSubmissions } from "@/lib/data/dashboard";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthorizedUser(request);
    const submissions = await getContributorSubmissions(user.id);
    return secureJson({
      dashboard: {
        profile: {
          displayName: user.displayName,
          handle: user.handle,
          role: user.role,
        },
        submissions,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
