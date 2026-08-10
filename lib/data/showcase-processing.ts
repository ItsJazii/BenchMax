import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts, showcases } from "@/db/schema";
import { scanQuarantinedArtifact } from "@/lib/security/artifact-scanner";

export const PROCESSING_FAILURE_CODE = "artifact_scan_unavailable";
export const PROCESSING_FAILURE_SUMMARY =
  "Evidence processing could not finish because the scanner was unavailable. Retry processing from your dashboard.";

export type ShowcaseProcessingRetryResult = {
  outcome: "ready" | "processing" | "blocked";
  publishable: boolean;
  safetyStatus: "scanning" | "approved" | "blocked";
  scannedArtifactIds: string[];
};

export function sanitizeArtifactScanFailureCode(error: unknown) {
  void error;
  return PROCESSING_FAILURE_CODE;
}

export async function recordShowcaseProcessingFailure(
  showcaseId: string,
  error: unknown,
) {
  const now = new Date();
  const code = sanitizeArtifactScanFailureCode(error);
  const [recorded] = await getDb()
    .update(showcases)
    .set({
      safetyStatus: "scanning",
      processingFailureCode: code,
      processingFailureSummary: PROCESSING_FAILURE_SUMMARY,
      processingFailedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.status, "draft"),
        isNull(showcases.benchmarkVersionId),
        inArray(showcases.safetyStatus, ["pending", "scanning", "approved"]),
      ),
    )
    .returning({ id: showcases.id });
  return recorded ? { code, failedAt: now } : null;
}

export async function retryShowcaseProcessing(
  showcaseId: string,
  ownerId: string,
): Promise<ShowcaseProcessingRetryResult> {
  const [showcase] = await getDb()
    .select({
      id: showcases.id,
      status: showcases.status,
      safetyStatus: showcases.safetyStatus,
      processingFailureCode: showcases.processingFailureCode,
    })
    .from(showcases)
    .where(
      and(
        eq(showcases.id, showcaseId),
        eq(showcases.ownerId, ownerId),
        isNull(showcases.benchmarkVersionId),
      ),
    )
    .limit(1);
  if (!showcase) {
    throw new ShowcaseProcessingRetryError(
      "Test was not found.",
      404,
    );
  }
  if (showcase.status !== "draft") {
    throw new ShowcaseProcessingRetryError(
      "Only private draft Tests can retry evidence processing.",
    );
  }
  if (showcase.safetyStatus === "blocked") {
    throw new ShowcaseProcessingRetryError(
      "Blocked evidence cannot be retried.",
    );
  }
  if (!showcase.processingFailureCode) {
    throw new ShowcaseProcessingRetryError(
      "No failed evidence-processing step is available to retry.",
    );
  }

  const initialArtifacts = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.showcaseId, showcaseId));
  if (initialArtifacts.length === 0) {
    throw new ShowcaseProcessingRetryError(
      "Upload evidence before retrying processing.",
    );
  }
  if (initialArtifacts.some((artifact) => artifact.quarantineStatus === "blocked")) {
    await setDefinitiveShowcaseSafety(showcaseId, "blocked");
    throw new ShowcaseProcessingRetryError("Blocked evidence cannot be retried.");
  }

  const eligibleArtifacts = initialArtifacts.filter(
    (artifact) =>
      artifact.quarantineStatus === "quarantined" ||
      artifact.quarantineStatus === "scanning",
  );
  const scannedArtifactIds: string[] = [];
  for (const artifact of eligibleArtifacts) {
    try {
      await scanQuarantinedArtifact(artifact);
      scannedArtifactIds.push(artifact.id);
    } catch (error) {
      await recordShowcaseProcessingFailure(showcaseId, error);
      throw new ShowcaseProcessingUnavailableError();
    }
  }

  const statuses = await getDb()
    .select({ status: artifacts.quarantineStatus })
    .from(artifacts)
    .where(eq(artifacts.showcaseId, showcaseId));
  if (statuses.some((artifact) => artifact.status === "blocked")) {
    await setDefinitiveShowcaseSafety(showcaseId, "blocked");
    return {
      outcome: "blocked",
      publishable: false,
      safetyStatus: "blocked",
      scannedArtifactIds,
    };
  }
  if (statuses.every((artifact) => artifact.status === "approved")) {
    await setDefinitiveShowcaseSafety(showcaseId, "approved");
    return {
      outcome: "ready",
      publishable: true,
      safetyStatus: "approved",
      scannedArtifactIds,
    };
  }

  await getDb()
    .update(showcases)
    .set({ safetyStatus: "scanning", updatedAt: new Date() })
    .where(eq(showcases.id, showcaseId));
  return {
    outcome: "processing",
    publishable: false,
    safetyStatus: "scanning",
    scannedArtifactIds,
  };
}

async function setDefinitiveShowcaseSafety(
  showcaseId: string,
  safetyStatus: "approved" | "blocked",
) {
  await getDb()
    .update(showcases)
    .set({
      safetyStatus,
      processingFailureCode: null,
      processingFailureSummary: null,
      processingFailedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(showcases.id, showcaseId));
}

export class ShowcaseProcessingRetryError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "ShowcaseProcessingRetryError";
    this.status = status;
  }
}

export class ShowcaseProcessingUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super(
      "Evidence processing is temporarily unavailable. Retry from your dashboard.",
    );
    this.name = "ShowcaseProcessingUnavailableError";
  }
}
