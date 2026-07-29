import { secureJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  getRequestIdentity,
  isBootstrapOwnerSubject,
  requireRequestIdentity,
} from "@/lib/auth/server";
import {
  createProfile,
  getUserByAuthSubject,
  profileInputSchema,
} from "@/lib/data/users";
import { appendAuditEvent } from "@/lib/data/audit";
import { apiErrorResponse, parseJson } from "@/lib/http/api";

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    if (!identity) return secureJson({ user: null });
    const user = await getUserByAuthSubject(identity.subject);
    if (!user) return secureJson({ user: null });
    return secureJson({
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireRequestIdentity(request);
    await enforceRateLimit(identity.subject, {
      action: "profile-create",
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    const existing = await getUserByAuthSubject(identity.subject);
    if (existing) {
      return secureJson({ error: "Profile already exists." }, { status: 409 });
    }

    const input = await parseJson(request, profileInputSchema);
    const user = await createProfile(
      identity.subject,
      input,
      isBootstrapOwnerSubject(identity.subject) ? "owner" : "contributor",
    );
    await appendAuditEvent({
      actorUserId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "profile.created",
      metadata: { role: user.role },
    });
    return secureJson(
      {
        user: {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          role: user.role,
          status: user.status,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
