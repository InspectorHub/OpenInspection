/**
 * Client-side RBAC helpers.
 *
 * `isAdminRole` is RE-EXPORTED from the server's role module, not reimplemented
 * here. It used to be a local copy whose own comment said it "mirrors" the
 * server — and a mirror is a copy. Type-only imports from `server/` are erased
 * at build, but this one is a real value import; it is safe because
 * `auth/roles.ts` is pure data and predicates with no server-only dependencies.
 *
 * This remains a presentation guard only — the server still enforces
 * `requireRole` on every privileged endpoint (defense in depth). A non-admin
 * who pokes the API directly is rejected server-side regardless of what the UI
 * renders.
 */
export { isAdminRole } from "../../server/lib/auth/roles";
import { isAdminRole } from "../../server/lib/auth/roles";

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
