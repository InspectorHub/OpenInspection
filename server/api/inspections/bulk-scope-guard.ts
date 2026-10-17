import type { Context, Next } from 'hono';
import { Errors } from '../../lib/errors';
import { getDrizzle } from '../../lib/route-helpers';
import { filterVisibleInspectionIds, resolveInspectionScope } from '../../lib/inspection/visibility';
import type { HonoConfig } from '../../types/hono';

/**
 * Defence in depth for `PATCH /api/inspections/bulk`.
 *
 * The capability gate in front of the route is already closed to anyone restricted to their assigned
 * inspections (`scheduleOthers` is switched off together with the scope). This is the second line, so the
 * two cannot both be dropped by one change: a batch that names an inspection outside the caller's set is
 * refused whole, before any write, with the answer a missing one gets.
 *
 * It reads the ids from a clone of the body and leaves a body it cannot read to the route's own validation.
 */
export function requireBatchInScope() {
    return async (c: Context<HonoConfig>, next: Next) => {
        const scope = await resolveInspectionScope(c);
        if (scope.kind === 'assigned') {
            const ids = await c.req.raw.clone().json().then((body) => (body as { ids?: unknown } | null)?.ids, () => undefined);
            if (Array.isArray(ids)) {
                const named = new Set(ids.filter((id): id is string => typeof id === 'string'));
                const visible = await filterVisibleInspectionIds(getDrizzle(c), scope, c.get('tenantId'), [...named]);
                if (visible.size !== named.size) throw Errors.NotFound('Inspection not found');
            }
        }
        return next();
    };
}
