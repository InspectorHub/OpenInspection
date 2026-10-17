import type { Context, Next } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Errors } from '../errors';
import { isUnauthenticatedPath } from '../auth/public-paths';
import { matchesRule, ANONYMOUS_API_ALLOW } from '../auth/api-access-policy';
import { deniedNeedsRole } from '../permission-denied';
import { ROLE, ROLE_TIER, isAdminRole } from '../auth/roles';
import { getDrizzle } from '../route-helpers';
import { memoOnce } from '../request-scope';
import { requireVisibleInspection, resolveInspectionScope } from '../inspection/visibility';
import type { HonoConfig } from '../../types/hono';

/**
 * Static first segments under /api/inspections. They are routes, never inspection ids.
 * A test compares this set with the static segments the route table actually carries.
 */
export const RESERVED_INSPECTION_SEGMENTS: ReadonlySet<string> = new Set([
    'bulk', 'counts', 'dashboard', 'inspectors', 'schedule-conflicts', 'templates', 'wizard',
]);

/** The tiers that may touch an inspection at all. `staff` is evaluated at the inspector tier. */
const STAFF_TIERS: ReadonlySet<string> = new Set([ROLE.OWNER, ROLE.MANAGER, ROLE.INSPECTOR]);

/**
 * Path guard for everything under `/api/inspections/:id`. One middleware covers the
 * whole family, so a route added later is protected by default instead of having to
 * remember to wear a guard of its own.
 */
export function inspectionScopeGuard() {
    const handler = async (c: Context<HonoConfig>, next: Next) => {
        const role = c.get('userRole');
        if (!role) {
            // The one anonymous route in this family is the published report's video clip, allow-listed by
            // the central access policy. Anything else without a session is refused here as well.
            const path = c.req.path;
            if (isUnauthenticatedPath(path) || matchesRule(ANONYMOUS_API_ALLOW, path)) return next();
            throw Errors.Unauthorized('No role found in context');
        }
        if (!STAFF_TIERS.has(ROLE_TIER[role] ?? '')) throw deniedNeedsRole(c, [ROLE.OWNER, ROLE.MANAGER, ROLE.INSPECTOR]);
        // The administrator tier is never narrowed: no capability read, no lookup.
        if (isAdminRole(role)) return next();
        // A static segment (templates, dashboard, ...) is a route, not an inspection id.
        const id = c.req.param('id');
        if (!id || RESERVED_INSPECTION_SEGMENTS.has(id)) return next();
        const scope = await resolveInspectionScope(c);
        if (scope.kind === 'all') return next();
        // Hidden, absent and another company's all answer the same 404 with the same body. Letting an
        // absent id fall through to the handler would not do: some handlers answer an absent id with
        // 200 and an empty list, or word the 404 differently, and the difference tells a restricted
        // caller which ids exist. A repeat inside one rendered page (the page makes many in-process
        // calls) shares the lookup.
        const tenantId = c.get('tenantId');
        const userId = scope.userId;
        await memoOnce(c.env, `inspection-visible:${tenantId}:${userId}:${id}`, () =>
            requireVisibleInspection(getDrizzle(c), scope, tenantId, id));
        return next();
    };
    return Object.assign(handler, { inspectionScopeGuard: true as const });
}

/**
 * Must run before any route is mounted: Hono applies middleware only to handlers
 * registered after it. A route-table test pins the order.
 */
export function registerInspectionScopeGuards(app: OpenAPIHono<HonoConfig>): void {
    const guard = inspectionScopeGuard();
    app.use('/api/inspections/:id', guard);
    app.use('/api/inspections/:id/*', guard);
}
