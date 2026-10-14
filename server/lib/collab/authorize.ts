/**
 * The fail-closed authorization every collab entry shares, and the stub lookup
 * that follows it.
 *
 * It lives here, not in the route module, because two callers need the very
 * same checks: the collab routes (which read the inspection id from the path)
 * and the offline package import (which authorizes each inspection the package
 * names, one by one, before it writes anything). A second copy of these checks
 * would drift from the first.
 */

import type { Context } from 'hono';
import { logger } from '../logger';
import type { HonoConfig } from '../../types/hono';
import { canAccessInspectionCollab } from './can-access';
import { getInspectionRoster } from '../inspection/roster';
import { collabDocName } from './doc-name';
import { resolvePrimaryReportId } from '../inspection/reports';
import { getDrizzle } from '../route-helpers';

/**
 * Result of the shared fail-closed auth: either an early `Response` (the caller
 * returns it verbatim) or the resolved identity needed to address the DO.
 */
export type AuthResult =
    | { ok: false; response: Response }
    | { ok: true; tenantId: string; inspectionId: string; reportId: string; userId: string };

/**
 * Shared fail-closed auth for every collab route (checks 1-5 documented in
 * `server/api/inspections/collab.ts`, excluding the WS-only Upgrade check).
 * Factored out so the snapshot/restore routes and the offline import can never
 * diverge from the ws route's checks.
 *
 * `inspectionId` defaults to the `:id` path parameter; the offline import passes
 * the id explicitly, because it has no such parameter.
 */
export async function authorizeCollab(
    c: Context<HonoConfig>,
    inspectionId: string | undefined = c.req.param('id'),
): Promise<AuthResult> {
    // (1) Feature-detect binding
    if (!c.env.INSPECTION_DOC) {
        return { ok: false, response: new Response('collab unavailable', { status: 501 }) };
    }

    // (2) Inspection id
    const id = inspectionId;
    if (!id) return { ok: false, response: new Response('not found', { status: 404 }) };

    // (3) Auth: JWT claims only (never from client)
    const tenantId = c.get('tenantId');
    const user     = c.get('user') as { sub?: string } | undefined;
    const userId   = user?.sub;
    if (!tenantId || !userId) {
        return { ok: false, response: new Response('unauthorized', { status: 401 }) };
    }

    // (4) Inspection lookup, tenant-scoped.
    // Called for the guard, not the row: it throws when the inspection does not
    // exist OR belongs to another tenant, which is the 404 below. Who may edit
    // comes from the roster in step 5.
    try {
        await c.var.services.inspection.getInspection(id, tenantId);
    } catch (err) {
        logger.error(
            'collab: inspection lookup failed',
            { inspectionId: id, tenantId },
            err instanceof Error ? err : undefined,
        );
        return { ok: false, response: new Response('not found', { status: 404 }) };
    }

    // (5) Edit-permission check (mirrors presence route)
    const userRole = c.get('userRole') as string | undefined;
    const roster = await getInspectionRoster(getDrizzle(c), tenantId, id);
    const allowed = canAccessInspectionCollab(roster, { id: userId, role: userRole ?? '' });

    if (!allowed) {
        return { ok: false, response: new Response('forbidden', { status: 403 }) };
    }

    // Which DOCUMENT is being edited. The route is addressed by inspection, so
    // the primary report is the answer for every caller today; when a client
    // can open the radon report directly it passes its own id and this becomes
    // a lookup rather than a default.
    const primaryReportId = await resolvePrimaryReportId(getDrizzle(c), tenantId, id);
    if (!primaryReportId) {
        // No report row means nothing to edit. Fail closed rather than falling
        // back to an inspection-keyed document, which is the shared-Y.Doc bug.
        return { ok: false, response: new Response('not found', { status: 404 }) };
    }

    return { ok: true, tenantId, inspectionId: id, reportId: primaryReportId, userId };
}

/**
 * Resolve the tenant-scoped DO stub for an authorized collab request.
 *
 * Keyed on the REPORT, not the inspection. Two inspectors working the standard
 * report and the sewer report of one order used to land in the same Durable
 * Object and share one Y.Doc: nothing threw, the CRDT merged content belonging
 * to two different documents, and the corruption surfaced when a client read a
 * report containing someone else's findings.
 * Only reached after `authorizeCollab` has proven `INSPECTION_DOC` is bound;
 * the explicit guard re-narrows for the type checker (the binding is optional
 * in the generated Env) and never throws in practice.
 */
export function collabStub(c: Context<HonoConfig>, tenantId: string, reportId: string) {
    const ns = c.env.INSPECTION_DOC;
    if (!ns) throw new Error('INSPECTION_DOC binding missing');
    const doId = ns.idFromName(collabDocName(tenantId, reportId));
    return ns.get(doId);
}
