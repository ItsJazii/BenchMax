import { env } from "cloudflare:workers";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts, showcases } from "@/db/schema";
import {
  inspectZipArchive,
  matchesMagicBytes,
  type ScanResult,
} from "./artifact-inspection";
import { detectSecretLabels, sha256Hex } from "./policy";

const MAX_INLINE_SOURCE_BYTES = 20 * 1024 * 1024;

type ArtifactRow = typeof artifacts.$inferSelect;

export async function scanQuarantinedArtifact(
  artifact: ArtifactRow,
): Promise<ScanResult> {
  if (artifact.kind === "image" || artifact.kind === "video") {
    return recordScanResult(artifact, await scanMedia(artifact));
  }

  const object = await env.UPLOADS.get(artifact.objectKey);
  if (!object) {
    return recordScanResult(artifact, {
      status: "blocked",
      sha256: null,
      checks: ["object-presence"],
      findings: ["Quarantined object is missing."],
    });
  }

  let result: ScanResult;
  if (artifact.kind === "log" || artifact.contentType === "text/plain") {
    result = await scanTextArtifact(artifact, object);
  } else {
    result = await scanZipArtifact(artifact, object);
  }
  return recordScanResult(artifact, result);
}

async function scanMedia(artifact: ArtifactRow): Promise<ScanResult> {
  const prefixObject = await env.UPLOADS.get(artifact.objectKey, {
    range: { offset: 0, length: 64 },
  });
  if (!prefixObject) {
    return {
      status: "blocked",
      sha256: null,
      checks: ["magic-bytes"],
      findings: ["Media object is missing."],
    };
  }
  const prefix = new Uint8Array(await prefixObject.arrayBuffer());
  const magicValid = matchesMagicBytes(artifact.contentType, prefix);
  return {
    status: magicValid ? "approved" : "blocked",
    sha256: null,
    checks: ["declared-size", "content-type-allowlist", "magic-bytes"],
    findings: magicValid
      ? []
      : ["File signature does not match its declared media type."],
  };
}

async function scanTextArtifact(
  artifact: ArtifactRow,
  object: R2ObjectBody,
): Promise<ScanResult> {
  if (artifact.byteSize > MAX_INLINE_SOURCE_BYTES) {
    return {
      status: "scanning",
      sha256: null,
      checks: ["declared-size", "content-type-allowlist"],
      findings: ["Awaiting bounded deep-content scanning."],
    };
  }
  const buffer = await object.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (artifact.contentType === "application/json") JSON.parse(text);
  } catch {
    return {
      status: "blocked",
      sha256: await sha256Hex(buffer),
      checks: ["utf-8", "structured-content"],
      findings: ["Text artifact is not valid UTF-8 or valid structured data."],
    };
  }
  const secretLabels = detectSecretLabels(text);
  return {
    status: secretLabels.length > 0 ? "blocked" : "approved",
    sha256: await sha256Hex(buffer),
    checks: ["utf-8", "secret-patterns", "content-sha256"],
    findings: secretLabels.map((label) => `Potential ${label} detected.`),
  };
}

async function scanZipArtifact(
  artifact: ArtifactRow,
  object: R2ObjectBody,
): Promise<ScanResult> {
  if (artifact.byteSize > MAX_INLINE_SOURCE_BYTES) {
    return {
      status: "scanning",
      sha256: null,
      checks: ["declared-size", "content-type-allowlist"],
      findings: ["Awaiting bounded deep archive scanning."],
    };
  }
  return inspectZipArchive(
    new Uint8Array(await object.arrayBuffer()),
  );
}

async function recordScanResult(
  artifact: ArtifactRow,
  result: ScanResult,
): Promise<ScanResult> {
  const now = new Date();
  let finalResult = result;
  if (result.status === "approved" && result.sha256) {
    const duplicate = await getDb()
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.showcaseId, artifact.showcaseId),
          eq(artifacts.sha256, result.sha256),
          ne(artifacts.id, artifact.id),
        ),
      )
      .limit(1);
    if (duplicate.length > 0) {
      finalResult = {
        ...result,
        status: "blocked",
        checks: [...result.checks, "duplicate-content"],
        findings: [
          ...result.findings,
          "This exact artifact is already attached to the submission.",
        ],
      };
    }
  }

  await getDb()
    .update(artifacts)
    .set({
      quarantineStatus: finalResult.status,
      sha256: finalResult.sha256,
      scanReportJson: JSON.stringify({
        version: 1,
        checks: finalResult.checks,
        findings: finalResult.findings,
        scannedAt: now.toISOString(),
      }),
      updatedAt: now,
    })
    .where(eq(artifacts.id, artifact.id));

  if (finalResult.status === "blocked") {
    await getDb()
      .update(showcases)
      .set({ safetyStatus: "blocked", updatedAt: now })
      .where(eq(showcases.id, artifact.showcaseId));
  } else {
    const remaining = await getDb()
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.showcaseId, artifact.showcaseId),
          ne(artifacts.quarantineStatus, "approved"),
        ),
      )
      .limit(1);
    if (remaining.length === 0 && finalResult.status === "approved") {
      await getDb()
        .update(showcases)
        .set({ safetyStatus: "approved", updatedAt: now })
        .where(eq(showcases.id, artifact.showcaseId));
    }
  }
  return finalResult;
}
