import type { LoadContext } from "~/lib/load-context";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { assertAdminOrForbidden, assertOwnerOrForbidden, isStaffRole } from "~/lib/access";
import type { Capability } from "../../server/lib/auth/capabilities";

/**
 * The current user's role, or `undefined` when it cannot be resolved.
 *
 * Its own function because BOTH guards below need it and neither may have its
 * own copy: a second `try`/`catch` around the same call is a second place for
 * the fail-closed default to be written differently, and a guard that fails
 * OPEN is invisible until somebody is standing on the wrong side of it.
 */
export async function resolveRole(
  context: LoadContext,
  token: string,
): Promise<string | undefined> {
  return (await resolveSessionUser(context, token))?.role;
}

/**
 * The signed-in user's role and RESOLVED capabilities from the session-context
 * API, or `undefined` when they cannot be read. The one place that call is made,
 * so `resolveRole` and the capability guard below fail closed in the same way.
 */
async function resolveSessionUser(
  context: LoadContext,
  token: string,
): Promise<{ role?: string; capabilities?: Partial<Record<Capability, boolean>> } | undefined> {
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      data?: { user?: { role?: string; capabilities?: Partial<Record<Capability, boolean>> } };
    };
    return body.data?.user;
  } catch {
    // Fail closed: an unresolved role is treated as no role at all.
    return undefined;
  }
}

/**
 * Loader-side guard for a page whose data the API serves only to a viewer holding
 * `capability`. `forbidden` is true when the capability is not a definite yes
 * (including when the session cannot be read), so the route renders its
 * no-permission notice instead of an empty page. UI guard only: the API still
 * enforces the capability itself.
 */
export async function requireCapabilityLoader(
  context: LoadContext,
  request: Request,
  capability: Capability,
): Promise<{ forbidden: boolean; token: string }> {
  const token = await requireToken(context, request);
  const user = await resolveSessionUser(context, token);
  return { forbidden: user?.capabilities?.[capability] !== true, token };
}

/** The same guard for a page that has nothing for an office (`staff`) user. */
export async function requireNotStaffLoader(
  context: LoadContext,
  request: Request,
): Promise<{ forbidden: boolean; token: string }> {
  const token = await requireToken(context, request);
  const role = await resolveRole(context, token);
  return { forbidden: role === undefined || isStaffRole(role), token };
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
