import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { sha256Hex } from "./policy";

type RateLimitPolicy = {
  action: string;
  limit: number;
  windowMs: number;
};

export async function enforceRateLimit(
  subject: string,
  policy: RateLimitPolicy,
): Promise<{ limit: number; remaining: number; resetsAt: Date }> {
  const now = Date.now();
  const windowStartedAtMs =
    Math.floor(now / policy.windowMs) * policy.windowMs;
  const expiresAt = new Date(windowStartedAtMs + policy.windowMs);
  const subjectHash = await sha256Hex(subject);
  const id = await sha256Hex(
    `${policy.action}:${subjectHash}:${windowStartedAtMs}`,
  );
  const db = getDb();

  const [record] = await db
    .insert(rateLimits)
    .values({
      id,
      action: policy.action,
      subjectHash,
      windowStartedAt: new Date(windowStartedAtMs),
      count: 1,
      expiresAt,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: rateLimits.id,
      set: {
        count: sql`${rateLimits.count} + 1`,
        updatedAt: new Date(now),
      },
    })
    .returning({ count: rateLimits.count });

  if (!record || record.count > policy.limit) {
    throw new RateLimitExceededError(expiresAt);
  }

  return {
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - record.count),
    resetsAt: expiresAt,
  };
}

export class RateLimitExceededError extends Error {
  readonly status = 429;

  constructor(readonly resetsAt: Date) {
    super("Too many requests. Try again after the current limit window.");
    this.name = "RateLimitExceededError";
  }
}
