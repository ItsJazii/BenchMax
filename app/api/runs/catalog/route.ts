import { listRunLaunchCatalog } from "@/lib/data/runs";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET() {
  try {
    return secureJson({ catalog: await listRunLaunchCatalog() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
