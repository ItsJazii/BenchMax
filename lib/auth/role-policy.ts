export type BenchmaxRole = "owner" | "moderator" | "contributor";

export function isRoleAllowed(
  role: BenchmaxRole,
  allowed: ReadonlyArray<BenchmaxRole>,
): boolean {
  return allowed.includes(role);
}
