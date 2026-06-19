/**
 * Client-side RBAC helpers. These mirror the server's role model
 * (`server/lib/auth/roles.ts`): `owner` and `manager` are the company
 * administrators; `inspector` and `agent` are not. Used to gate settings UI
 * and to compute a `forbidden` flag in loaders for company-only routes.
 *
 * This is a presentation guard only — the server still enforces `requireRole`
 * on every privileged endpoint (defense in depth). A non-admin who pokes the
 * API directly is rejected server-side regardless of what the UI renders.
 */
const ADMIN_ROLES = new Set(["owner", "manager"]);

export function isAdminRole(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.has(role);
}

/**
 * Loader-side guard: returns a serialisable flag a company-only route can
 * return from its loader. The route component renders <AccessDenied/> first
 * when `forbidden` is true. One helper, called by every guarded loader (DRY).
 */
export function assertAdminOrForbidden(
  role: string | null | undefined,
): { forbidden: boolean } {
  return { forbidden: !isAdminRole(role) };
}
