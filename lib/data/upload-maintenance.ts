import { env } from "cloudflare:workers";
import {
  listExpiredUploadSessions,
  markUploadSessionsExpired,
  markUploadSessionsQuarantineCleaned,
  markUploadSessionsUploaded,
} from "./uploads";
import {
  planExpiredUploadCleanup,
} from "@/lib/storage/upload-keys";

export async function sweepExpiredUploadSessions(limit = 100) {
  const sessions = await listExpiredUploadSessions(limit);
  const expiredIds: string[] = [];
  const recoveredIds: string[] = [];
  const cleanedIds: string[] = [];
  for (const session of sessions) {
    const plan = planExpiredUploadCleanup({
      artifactExists: Boolean(session.artifactExists),
      fileName: session.fileName,
      objectKey: session.objectKey,
      sessionId: session.id,
      status: session.status,
      userId: session.userId,
    });
    if (!plan) continue;
    await Promise.all(plan.deleteKeys.map((key) => env.UPLOADS.delete(key)));
    cleanedIds.push(session.id);
    if (plan.nextStatus === "uploaded") recoveredIds.push(session.id);
    else if (plan.nextStatus === "expired") expiredIds.push(session.id);
  }
  await Promise.all([
    markUploadSessionsExpired(expiredIds),
    markUploadSessionsUploaded(recoveredIds),
    markUploadSessionsQuarantineCleaned(cleanedIds),
  ]);
  return expiredIds.length;
}
