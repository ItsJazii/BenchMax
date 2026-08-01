import { getPublicShowcaseBySlug } from "@/lib/data/showcases";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      return secureJson({ error: "Result not found." }, { status: 404 });
    }
    const result = await getPublicShowcaseBySlug(slug);
    if (!result) {
      return secureJson({ error: "Result not found." }, { status: 404 });
    }
    return secureJson({ result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
