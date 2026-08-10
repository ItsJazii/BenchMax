import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts, showcases } from "@/db/schema";
import {
  inspectZipArchive,
  matchesMagicBytes,
  type ScanResult,
} from "./artifact-inspection";
import {
  constantTimeEqualHex,
  detectSecretLabels,
  sha256Hex,
} from "./policy";
import { screenJudgeInjection } from "@/lib/judging/protocol";

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
  const object = await env.UPLOADS.get(artifact.objectKey);
  if (!object) {
    return {
      status: "blocked",
      sha256: null,
      checks: ["magic-bytes"],
      findings: ["Media object is missing."],
    };
  }
  const { prefix, sha256 } = await hashObjectBody(object.body);
  const magicValid = matchesMagicBytes(artifact.contentType, prefix);
  return {
    status: magicValid ? "approved" : "blocked",
    sha256,
    checks: [
      "declared-size",
      "content-type-allowlist",
      "magic-bytes",
      "content-sha256",
    ],
    findings: magicValid
      ? []
      : ["File signature does not match its declared media type."],
  };
}

export async function verifyApprovedShowcaseArtifacts(showcaseId: string) {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.showcaseId, showcaseId),
        eq(artifacts.quarantineStatus, "approved"),
      ),
    );
  for (const artifact of rows) {
    if (
      !artifact.sha256 ||
      !artifact.objectKey.startsWith(`evidence/${artifact.uploaderId}/`)
    ) {
      await blockChangedArtifact(artifact);
      throw new ArtifactIntegrityError();
    }
    const object = await env.UPLOADS.get(artifact.objectKey);
    if (
      !object ||
      object.size !== artifact.byteSize ||
      object.httpMetadata?.contentType !== artifact.contentType ||
      object.customMetadata?.immutableEvidence !== "true"
    ) {
      await blockChangedArtifact(artifact);
      throw new ArtifactIntegrityError();
    }
    const { sha256 } = await hashObjectBody(object.body);
    if (!constantTimeEqualHex(sha256, artifact.sha256)) {
      await blockChangedArtifact(artifact);
      throw new ArtifactIntegrityError();
    }
  }
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
  const injection = screenJudgeInjection(null, [
    { label: `submitted-${artifact.kind}`, value: text },
  ]);
  return {
    status: secretLabels.length > 0 ? "blocked" : "approved",
    sha256: await sha256Hex(buffer),
    checks: [
      "utf-8",
      "secret-patterns",
      "prompt-injection",
      "content-sha256",
    ],
    findings: [
      ...secretLabels.map((label) => `Potential ${label} detected.`),
      ...injection.findings.map(
        (finding) =>
          `Potential prompt-injection pattern ${finding.pattern} in ${finding.file}.`,
      ),
    ],
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
  const bytes = new Uint8Array(await object.arrayBuffer());
  const result = await inspectZipArchive(bytes);
  if (result.status !== "approved") return result;
  const injection = screenJudgeInjection(bytes);
  return {
    ...result,
    checks: [...result.checks, "prompt-injection"],
    findings: [
      ...result.findings,
      ...injection.findings.map(
        (finding) =>
          `Potential prompt-injection pattern ${finding.pattern} in ${finding.file}.`,
      ),
    ],
  };
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

async function hashObjectBody(body: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256");
  const prefixChunks: Uint8Array[] = [];
  let prefixBytes = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (prefixBytes < 64) {
      const remaining = 64 - prefixBytes;
      const chunk = value.subarray(0, remaining);
      prefixChunks.push(chunk);
      prefixBytes += chunk.length;
    }
  }
  const prefix = new Uint8Array(prefixBytes);
  let offset = 0;
  for (const chunk of prefixChunks) {
    prefix.set(chunk, offset);
    offset += chunk.length;
  }
  return { prefix, sha256: hash.digest("hex") };
}

async function blockChangedArtifact(artifact: ArtifactRow) {
  const now = new Date();
  await getDb().batch([
    getDb()
      .update(artifacts)
      .set({
        quarantineStatus: "blocked",
        scanReportJson: JSON.stringify({
          version: 1,
          checks: ["publish-time-content-sha256"],
          findings: ["Stored evidence changed after its approved security scan."],
          scannedAt: now.toISOString(),
        }),
        updatedAt: now,
      })
      .where(eq(artifacts.id, artifact.id)),
    getDb()
      .update(showcases)
      .set({ safetyStatus: "blocked", updatedAt: now })
      .where(eq(showcases.id, artifact.showcaseId)),
  ]);
}

export class ArtifactIntegrityError extends Error {
  readonly status = 409;

  constructor() {
    super("Evidence changed after scanning and must be uploaded again.");
    this.name = "ArtifactIntegrityError";
  }
}
