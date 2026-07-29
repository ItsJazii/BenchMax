import type { RequestIdentity } from "./server";
import { requireRequestIdentity } from "./server";
import { getUserByAuthSubject } from "@/lib/data/users";
import { isRoleAllowed } from "./role-policy";

export type AuthorizedUser = NonNullable<
  Awaited<ReturnType<typeof getUserByAuthSubject>>
>;

export async function requireAuthorizedUser(
  request: Request,
): Promise<{ identity: RequestIdentity; user: AuthorizedUser }> {
  const identity = await requireRequestIdentity(request);
  const user = await getUserByAuthSubject(identity.subject);
  if (!user) throw new ProfileRequiredError();
  if (user.status !== "active") throw new AccountUnavailableError();
  return { identity, user };
}

export function requireRole(
  user: AuthorizedUser,
  roles: ReadonlyArray<AuthorizedUser["role"]>,
) {
  if (!isRoleAllowed(user.role, roles)) throw new ForbiddenError();
}

export class ProfileRequiredError extends Error {
  readonly status = 403;

  constructor() {
    super("Complete your Benchmax profile before creating submissions.");
    this.name = "ProfileRequiredError";
  }
}

export class AccountUnavailableError extends Error {
  readonly status = 403;

  constructor() {
    super("This account cannot perform write actions.");
    this.name = "AccountUnavailableError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "ForbiddenError";
  }
}
