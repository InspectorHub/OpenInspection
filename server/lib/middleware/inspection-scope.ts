import type { Context, Next } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Errors } from '../errors';
import { deniedNeedsRole } from '../permission-denied';
import { ROLE, ROLE_TIER } from '../auth/roles';
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
        if (!role) throw Errors.Unauthorized('No role found in context');
        if (!STAFF_TIERS.has(ROLE_TIER[role] ?? '')) throw deniedNeedsRole(c, [ROLE.OWNER, ROLE.MANAGER, ROLE.INSPECTOR]);
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
