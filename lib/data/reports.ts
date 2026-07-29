import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { abuseReports, runs, showcases } from "@/db/schema";
import type { z } from "zod";
import {
  abuseReportSchema,
  containsControlCharacters,
  detectSecretLabels,
  parseReportTarget,
} from "@/lib/security/policy";
import { SensitiveContentError } from "./showcases";

export class ReportTargetError extends Error {
  readonly status = 404;

  constructor() {
    super("That public Benchmax record could not be found.");
    this.name = "ReportTargetError";
  }
}

export async function createAbuseReport(
  reporterUserId: string,
  input: z.infer<typeof abuseReportSchema>,
) {
  const parsed = abuseReportSchema.parse(input);
  const target = parseReportTarget(parsed.url);
  if (!target) throw new ReportTargetError();
  if (containsControlCharacters(parsed.details)) {
    throw new Error("Report text contains unsupported control characters.");
  }
  const secrets = detectSecretLabels(parsed.details);
  if (secrets.length > 0) throw new SensitiveContentError(secrets);

  const [record] =
    target.kind === "showcase"
      ? await getDb()
          .select({ id: showcases.id })
          .from(showcases)
          .where(
            and(
              eq(showcases.slug, target.slug),
              eq(showcases.status, "published"),
              eq(showcases.safetyStatus, "approved"),
            ),
          )
          .limit(1)
      : await getDb()
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              eq(runs.publicSlug, target.slug),
              eq(runs.status, "published"),
            ),
          )
          .limit(1);
  if (!record) throw new ReportTargetError();

  const id = crypto.randomUUID();
  const [report] = await getDb()
    .insert(abuseReports)
    .values({
      id,
      reporterUserId,
      showcaseId: target.kind === "showcase" ? record.id : null,
      runId: target.kind === "run" ? record.id : null,
      reason: parsed.reason,
      details: parsed.details,
      status: "open",
      createdAt: new Date(),
    })
    .returning({
      id: abuseReports.id,
      status: abuseReports.status,
      createdAt: abuseReports.createdAt,
    });
  return report;
}
