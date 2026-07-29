import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";

export async function appendAuditEvent(input: {
  action: string;
  actorUserId?: string | null;
  entityId: string;
  entityType: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  await getDb().insert(auditEvents).values({
    id: crypto.randomUUID(),
    actorUserId: input.actorUserId ?? null,
    entityId: input.entityId,
    entityType: input.entityType,
    action: input.action,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt: now,
  });
}
