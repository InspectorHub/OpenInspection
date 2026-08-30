import type { LoadContext } from "~/lib/load-context";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { assertAdminOrForbidden, assertOwnerOrForbidden } from "~/lib/access";

/**
 * The current user's role, or `undefined` when it cannot be resolved.
 *
 * Its own function because BOTH guards below need it and neither may have its
 * own copy: a second `try`/`catch` around the same call is a second place for
 * the fail-closed default to be written differently, and a guard that fails
 * OPEN is invisible until somebody is standing on the wrong side of it.
 */
async function resolveRole(
  context: LoadContext,
  token: string,
): Promise<string | undefined> {
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: { user?: { role?: string } } };
    return body.data?.user?.role;
  } catch {
    // Fail closed: an unresolved role is treated as no role at all.
    return undefined;
  }
}

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
  context: LoadContext,
  request: Request,
): Promise<{ forbidden: boolean; token: string }> {
  const token = await requireToken(context, request);
  return { ...assertAdminOrForbidden(await resolveRole(context, token)), token };
}

/**
 * The same guard for a route whose API is `requireRole('owner')` — a manager is
 * forbidden here, and is told so by the page rather than by a 403 arriving
 * after they filled a form in.
 */
export async function requireOwnerLoader(
  context: LoadContext,
  request: Request,
): Promise<{ forbidden: boolean; token: string }> {
  const token = await requireToken(context, request);
  return { ...assertOwnerOrForbidden(await resolveRole(context, token)), token };
}
