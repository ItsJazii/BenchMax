import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  harnesses,
  models,
  modelVersions,
  providers,
} from "@/db/schema";
import { listCommunityTests } from "@/lib/data/community-tests";
import { apiErrorResponse } from "@/lib/http/api";
import { secureJson } from "@/lib/security/http";

export async function GET() {
  try {
    const [tests, modelRows, harnessRows] = await Promise.all([
      listCommunityTests(),
      getDb()
        .select({
          id: modelVersions.id,
          family: models.name,
          provider: providers.name,
          version: modelVersions.versionLabel,
        })
        .from(modelVersions)
        .innerJoin(models, eq(models.id, modelVersions.modelId))
        .innerJoin(providers, eq(providers.id, models.providerId))
        .where(eq(models.status, "active"))
        .orderBy(models.name, modelVersions.versionLabel),
      getDb()
        .select({
          id: harnesses.id,
          name: harnesses.name,
          version: harnesses.version,
        })
        .from(harnesses)
        .where(
          and(
            eq(harnesses.status, "active"),
            ne(harnesses.id, "benchmax-web-agent-v1"),
          ),
        )
        .orderBy(harnesses.name),
    ]);
    return secureJson({
      catalog: { tests, models: modelRows, harnesses: harnessRows },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
