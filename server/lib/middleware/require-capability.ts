import type { Context, Next } from 'hono';
import { Errors } from '../errors';
import {
    getCapabilities,
    coerceOverrides,
    type Capability,
    type CapabilitySet,
    type PermissionOverrides,
} from '../auth/capabilities';
import { isRole } from '../auth/roles';
import { users } from '../db/schema';

/**
 * Resolve the acting user's permission_overrides FRESH from the tenant-scoped
 * DB. Overrides can be changed by an admin without the affected user
 * re-logging-in, and the JWT does NOT carry them — so reading the column on
 * every gated request is the only correct source of truth.
 *
 * Returns null (pure role template) when there is no sdb, no user id, the row
 * is missing, or the column is empty. owner/agent capabilities are pinned in
 * getCapabilities(), so a missing/stale row still yields correct results for
 * those roles regardless of what we return here.
 */
export type OverrideResolver = (c: Context) => Promise<PermissionOverrides | null>;

const resolveOverridesFromDb: OverrideResolver = async (c) => {
    const userId = c.get('user')?.sub;
    const sdb = c.get('sdb');
    if (!userId || !sdb) return null;
    // getById is tenant-scoped (users has a tenantId column) and fail-closed.
    const row = await sdb.getById(users, userId);
    // permission_overrides is drizzle { mode: 'json' } → may be an object,
    // a string, or null. coerceOverrides handles all three and whitelists
    // to the four boolean capability keys.
    return coerceOverrides(row?.permissionOverrides ?? null);
};

/**
 * The acting user's full capability set, resolved the same way the middleware
 * resolves it (fresh overrides from the DB, role defaults, pinned guardrails).
 *
 * Handlers need this, not just middleware: a gate can only answer "may you call
 * this endpoint", while an endpoint that returns a MIXTURE of permitted and
 * restricted data has to decide field by field. `GET /inspections/:id/hub` is
 * exactly that — an inspector may see the inspection but not its money — so it
 * projects with `redactMoney(payload, await capabilitiesFor(c))` rather than
 * refusing the whole request.
 *
 * Sharing one resolver is the point. `financial` was correct in the middleware
 * and still leaked, because two endpoints simply never wore it; a second,
 * hand-rolled way to compute capabilities would invite the same divergence.
 */
export async function capabilitiesFor(
    c: Context,
    resolveOverrides: OverrideResolver = resolveOverridesFromDb,
): Promise<CapabilitySet> {
    const role = c.get('userRole');
    if (!isRole(role)) throw Errors.Unauthorized('No role found in context');
    return getCapabilities(role, await resolveOverrides(c));
}

/**
 * Layer a capability check ON TOP of an existing requireRole() gate. owner/admin
 * always pass (defaults grant all four capabilities); the inspector role is the
 * only one a per-user override can restrict (publish:false) or elevate
 * (financial/scheduleOthers/manageContacts:true). agent is pinned to all-false.
 *
 * `resolveOverrides` is injectable purely so unit tests can supply overrides
 * deterministically without a real D1; production always uses the DB resolver.
 */
export const requireCapability = (
    cap: Capability,
    resolveOverrides: OverrideResolver = resolveOverridesFromDb,
) => async (c: Context, next: Next) => {
    const caps = await capabilitiesFor(c, resolveOverrides);
    if (!caps[cap]) {
        throw Errors.Forbidden(`Requires the '${cap}' capability`);
    }
    return next();
};
