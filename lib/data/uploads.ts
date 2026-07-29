import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artifacts,
  showcases,
  uploadSessions,
  type users,
} from "@/db/schema";
import type { ArtifactKind } from "@/lib/security/policy";
import {
  UPLOAD_SESSION_TTL_MS,
  sha256Hex,
} from "@/lib/security/policy";

type UserRow = typeof users.$inferSelect;

export function createOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function createUploadSession(input: {
  byteSize: number;
  contentType: string;
  fileName: string;
  kind: ArtifactKind;
  showcaseId: string;
  user: UserRow;
}) {
  const db = getDb();
  const [showcase] = await db
    .select({ id: showcases.id })
    .from(showcases)
    .where(
      and(
        eq(showcases.id, input.showcaseId),
        eq(showcases.ownerId, input.user.id),
        eq(showcases.status, "draft"),
      ),
    )
    .limit(1);
  if (!showcase) throw new UploadSessionError("Draft not found.");

  const now = new Date();
  const [artifactUsage, pendingUsage, accountArtifactUsage, accountPendingUsage] =
    await Promise.all([
      db
        .select({
          bytes: sql<number>`coalesce(sum(${artifacts.byteSize}), 0)`,
        })
        .from(artifacts)
        .where(eq(artifacts.showcaseId, input.showcaseId)),
      db
        .select({
          bytes: sql<number>`coalesce(sum(${uploadSessions.expectedBytes}), 0)`,
        })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.showcaseId, input.showcaseId),
            inArray(uploadSessions.status, ["created", "uploading"]),
            gt(uploadSessions.expiresAt, now),
          ),
        ),
      db
        .select({
          bytes: sql<number>`coalesce(sum(${artifacts.byteSize}), 0)`,
        })
        .from(artifacts)
        .where(eq(artifacts.uploaderId, input.user.id)),
      db
        .select({
          bytes: sql<number>`coalesce(sum(${uploadSessions.expectedBytes}), 0)`,
        })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.userId, input.user.id),
            inArray(uploadSessions.status, ["created", "uploading"]),
            gt(uploadSessions.expiresAt, now),
          ),
        ),
    ]);
  const submissionBytes =
    Number(artifactUsage[0]?.bytes ?? 0) +
    Number(pendingUsage[0]?.bytes ?? 0) +
    input.byteSize;
  if (submissionBytes > 1024 * 1024 * 1024) {
    throw new UploadQuotaError(
      "This upload would exceed the 1 GB submission quota.",
    );
  }
  const accountBytes =
    Number(accountArtifactUsage[0]?.bytes ?? 0) +
    Number(accountPendingUsage[0]?.bytes ?? 0) +
    input.byteSize;
  if (accountBytes > 5 * 1024 * 1024 * 1024) {
    throw new UploadQuotaError(
      "This upload would exceed the account storage quota.",
    );
  }
  const id = crypto.randomUUID();
  const token = createOpaqueToken();
  const tokenDigest = await sha256Hex(token);
  const safeSegment = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `quarantine/${input.user.id}/${id}/${safeSegment}`;
  const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS);

  const [session] = await db
    .insert(uploadSessions)
    .values({
      id,
      userId: input.user.id,
      showcaseId: input.showcaseId,
      artifactKind: input.kind,
      objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      expectedBytes: input.byteSize,
      tokenDigest,
      status: "created",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { session, token };
}

export async function getUploadSession(id: string) {
  const [session] = await getDb()
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, id))
    .limit(1);
  return session ?? null;
}

export async function getOwnedUploadSession(id: string, userId: string) {
  const [session] = await getDb()
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, id), eq(uploadSessions.userId, userId)),
    )
    .limit(1);
  return session ?? null;
}

export async function markSessionUploading(id: string) {
  await getDb()
    .update(uploadSessions)
    .set({ status: "uploading", updatedAt: new Date() })
    .where(
      and(eq(uploadSessions.id, id), eq(uploadSessions.status, "created")),
    );
}

export async function finalizeUploadedArtifact(input: {
  sessionId: string;
  sha256?: string | null;
}) {
  const session = await getUploadSession(input.sessionId);
  if (!session || !session.showcaseId) {
    throw new UploadSessionError("Upload session not found.");
  }
  if (
    session.status === "expired" ||
    session.status === "cancelled" ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw new UploadSessionError("Upload session has expired.");
  }

  const now = new Date();
  const [existingArtifact] = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.objectKey, session.objectKey))
    .limit(1);
  if (existingArtifact) return existingArtifact;

  const [artifact] = await getDb()
    .insert(artifacts)
    .values({
      id: crypto.randomUUID(),
      showcaseId: session.showcaseId,
      uploaderId: session.userId,
      kind: session.artifactKind,
      objectKey: session.objectKey,
      fileName: session.fileName,
      contentType: session.contentType,
      byteSize: session.expectedBytes,
      sha256: input.sha256 ?? null,
      quarantineStatus: "quarantined",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await getDb()
    .update(uploadSessions)
    .set({ status: "uploaded", updatedAt: now })
    .where(eq(uploadSessions.id, session.id));
  await getDb()
    .update(showcases)
    .set({ safetyStatus: "scanning", updatedAt: now })
    .where(eq(showcases.id, session.showcaseId));

  return artifact;
}

export class UploadSessionError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "UploadSessionError";
  }
}

export class UploadQuotaError extends Error {
  readonly status = 413;

  constructor(message: string) {
    super(message);
    this.name = "UploadQuotaError";
  }
}
