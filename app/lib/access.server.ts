import type { AppLoadContext } from "react-router";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { assertAdminOrForbidden } from "~/lib/access";

/**
 * Loader-side RBAC guard for company-only settings routes. Resolves the
 * current user's role from the session-context API and returns
 * `{ forbidden, token }`:
 *   - `forbidden` is true for inspectors / agents (and when the role can't be
 *     resolved — fail closed) so the route renders <AccessDenied/> first.
 *   - `token` is returned so the caller can reuse it for its real data fetch
 *     without requiring the token a second time.
 *
 * This is a UI guard only. The server still enforces `requireRole` on every
 * privileged endpoint, so a non-admin who calls the API directly is rejected
 * regardless of what the loader returns (defense in depth). One helper, called
 * by every guarded loader (DRY) — no per-route copy-paste.
 */
export async function requireAdminLoader(
  context: AppLoadContext,
  request: Request,
): Promise<{ forbidden: boolean; token: string }> {
  const token = await requireToken(context, request);
  let role: string | null | undefined;
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (res.ok) {
      const body = (await res.json()) as { data?: { user?: { role?: string } } };
      role = body.data?.user?.role;
    }
  } catch {
    // Fail closed: an unresolved role is treated as non-admin.
    role = undefined;
  }
  return { ...assertAdminOrForbidden(role), token };
}
