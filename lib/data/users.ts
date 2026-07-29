import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";

const handlePattern = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/;

export const profileInputSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    handle: z.string().trim().toLowerCase().regex(handlePattern),
  })
  .strict();

export async function getUserByAuthSubject(authSubject: string) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.authSubject, authSubject))
    .limit(1);
  return user ?? null;
}

export async function createProfile(
  authSubject: string,
  input: z.infer<typeof profileInputSchema>,
  role: "owner" | "contributor" = "contributor",
) {
  const parsed = profileInputSchema.parse(input);
  const now = new Date();
  const [user] = await getDb()
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      authSubject,
      handle: parsed.handle,
      displayName: parsed.displayName,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return user;
}
