import { createClerkClient } from "@clerk/backend";

export type RequestIdentity = {
  sessionId: string;
  subject: string;
};

function getAllowedParties(): string[] {
  const parties = new Set<string>();
  for (const value of process.env.CLERK_AUTHORIZED_PARTIES?.split(",") ?? []) {
    const candidate = value.trim();
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const isLocal =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (
        (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        continue;
      }
      parties.add(url.origin);
    } catch {
      // Invalid entries never broaden the authorization boundary.
    }
  }
  return [...parties];
}

export function isAuthorizedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return getAllowedParties().includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      getAllowedParties().length > 0,
  );
}

export function hasVerifiedClerkEmail(
  emailAddresses: ReadonlyArray<{
    verification?: { status?: string | null } | null;
  }>,
): boolean {
  return emailAddresses.some(
    (email) => email.verification?.status === "verified",
  );
}

export function isBootstrapOwnerSubject(subject: string): boolean {
  return (process.env.BENCHMAX_OWNER_SUBJECTS?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(subject);
}

export async function getRequestIdentity(
  request: Request,
): Promise<RequestIdentity | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const allowedParties = getAllowedParties();
  if (!secretKey || !publishableKey || allowedParties.length === 0) return null;

  const clerk = createClerkClient({ secretKey, publishableKey });
  const state = await clerk.authenticateRequest(request, {
    acceptsToken: "session_token",
    authorizedParties: allowedParties,
    jwtKey: process.env.CLERK_JWT_KEY,
  });
  if (!state.isAuthenticated) return null;

  const auth = state.toAuth();
  if (!auth.userId || !auth.sessionId) return null;
  const clerkUser = await clerk.users.getUser(auth.userId);
  const hasVerifiedEmail = hasVerifiedClerkEmail(clerkUser.emailAddresses);
  if (!hasVerifiedEmail) return null;
  return { subject: auth.userId, sessionId: auth.sessionId };
}

export async function requireRequestIdentity(
  request: Request,
): Promise<RequestIdentity> {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    if (request.body) {
      await request.body.cancel("authentication_rejected").catch(() => {});
    }
    throw new AuthRequiredError();
  }
  return identity;
}

export class AuthRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super("Authentication required.");
    this.name = "AuthRequiredError";
  }
}
