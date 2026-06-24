/**
 * Collab routes — GET /api/inspections/:id/collab/ws plus the #181 Phase 4
 * snapshot version-history routes (snapshots list / capture / restore).
 *
 * Authorization pattern (shared by every route here) mirrors the presence WS
 * route (server/api/inspections/core.ts, `.get('/:id/presence/ws', ...)`):
 *
 *   1. Feature-detect `env.INSPECTION_DOC` — 501 if absent.
 *   2. Require an inspection id param — 404 otherwise.
 *   3. Resolve tenantId + userId from the JWT (set by the global auth
 *      middleware) — 401 if either is missing.
 *   4. Load the inspection via `services.inspection.getInspection(id, tenantId)`
 *      (tenant-scoped service call) — 404 if not found.
 *   5. Check that the caller is on the inspection (inspectorId /
 *      leadInspectorId / helperInspectorIds) — 403 otherwise.
 *
 * The WS upgrade route adds the `Upgrade: websocket` (426) check on top. All
 * routes forward to the INSPECTION_DOC DO keyed by `${tenantId}:${id}`,
 * passing tenantId + inspectionId (+ userId) as request headers (the DO reads
 * them for persistence/attribution; it trusts the route as the sole trust
 * boundary).
 *
 * The route is mounted at `/` in the inspections aggregator
 * (server/api/inspections.ts), same as the other sub-routers.
 */

import type { Context } from 'hono';
import { createApiRouter } from '../../lib/openapi-router';
import { logger } from '../../lib/logger';
import { CollabRestoreRequestSchema, CollabSnapshotParamSchema } from '../../lib/validations/collab.schema';
import type { HonoConfig } from '../../types/hono';
import { canAccessInspectionCollab } from '../../lib/collab/can-access';

/**
 * Result of the shared fail-closed auth: either an early `Response` (the caller
 * returns it verbatim) or the resolved identity needed to address the DO.
 */
type AuthResult =
    | { ok: false; response: Response }
    | { ok: true; tenantId: string; inspectionId: string; userId: string };

/**
 * Shared fail-closed auth for every collab route (checks 1–5 above, excluding
 * the WS-only Upgrade check). Factored out so the snapshot/restore routes can
 * never diverge from the ws route's checks.
 */
async function authorizeCollab(c: Context<HonoConfig>): Promise<AuthResult> {
    // ── (1) Feature-detect binding ────────────────────────────────────────────
    if (!c.env.INSPECTION_DOC) {
        return { ok: false, response: new Response('collab unavailable', { status: 501 }) };
    }

    // ── (2) Inspection id param ───────────────────────────────────────────────
    const id = c.req.param('id');
    if (!id) return { ok: false, response: new Response('not found', { status: 404 }) };

    // ── (3) Auth — JWT claims only (never from client) ────────────────────────
    const tenantId = c.get('tenantId');
    const user     = c.get('user') as { sub?: string } | undefined;
    const userId   = user?.sub;
    if (!tenantId || !userId) {
        return { ok: false, response: new Response('unauthorized', { status: 401 }) };
    }

    // ── (4) Inspection lookup — tenant-scoped ─────────────────────────────────
    let inspection: {
        id:                 string;
        inspectorId:        string | null;
        leadInspectorId:    string | null;
        helperInspectorIds: string;
    };
    try {
        const out = await c.var.services.inspection.getInspection(id, tenantId);
        inspection = out.inspection;
    } catch (err) {
        logger.error(
            'collab: inspection lookup failed',
            { inspectionId: id, tenantId },
            err instanceof Error ? err : undefined,
        );
        return { ok: false, response: new Response('not found', { status: 404 }) };
    }

    // ── (5) Edit-permission check (mirrors presence route) ────────────────────
    const userRole = c.get('userRole') as string | undefined;
    const allowed = canAccessInspectionCollab(inspection, { id: userId, role: userRole ?? '' });

    if (!allowed) {
        return { ok: false, response: new Response('forbidden', { status: 403 }) };
    }

    return { ok: true, tenantId, inspectionId: id, userId };
}

/**
 * Resolve the tenant-scoped DO stub for an authorized collab request.
 * Only reached after `authorizeCollab` has proven `INSPECTION_DOC` is bound;
 * the explicit guard re-narrows for the type checker (the binding is optional
 * in the generated Env) and never throws in practice.
 */
function collabStub(c: Context<HonoConfig>, tenantId: string, inspectionId: string) {
    const ns = c.env.INSPECTION_DOC;
    if (!ns) throw new Error('INSPECTION_DOC binding missing');
    const doId = ns.idFromName(`${tenantId}:${inspectionId}`);
    return ns.get(doId);
}

const collabRoutes = createApiRouter()
    .get('/:id/collab/ws', async (c) => {
        // ── (0) WebSocket protocol check (ws-only) ────────────────────────────
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket upgrade', { status: 426 });
        }

        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        // ── Forward the WS upgrade to the INSPECTION_DOC Durable Object ────────
        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':         'websocket',
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── GET /:id/collab/snapshots — list version history ──────────────────────
    .get('/:id/collab/snapshots', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request('https://do.local/snapshots', {
            method:  'GET',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── GET /:id/collab/snapshots/:seq — one snapshot's full projection ───────
    // H2's compare/recover UI diffs two snapshots → it needs each one's full
    // `projection` (the list route omits it). Mirrors the list route's auth +
    // tenant-scoped DO addressing; the :seq param is Zod-validated as a
    // non-negative int before it is forwarded (the DO re-guards as well).
    .get('/:id/collab/snapshots/:seq', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const parsedParam = CollabSnapshotParamSchema.safeParse({ seq: c.req.param('seq') });
        if (!parsedParam.success) {
            return c.json({ error: 'invalid snapshot seq' }, 400);
        }

        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request(`https://do.local/snapshots/${parsedParam.data.seq}`, {
            method:  'GET',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/snapshots — capture an on-demand snapshot ─────────────
    .post('/:id/collab/snapshots', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request('https://do.local/snapshots', {
            method:  'POST',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/restore — doc-replacement restore to a snapshot ───────
    .post('/:id/collab/restore', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        // Zod-validate the body (repo rule — schema lives in the validations module).
        let parsedBody: unknown;
        try {
            parsedBody = await c.req.json();
        } catch {
            return c.json({ error: 'invalid JSON body' }, 400);
        }
        const parsed = CollabRestoreRequestSchema.safeParse(parsedBody);
        if (!parsed.success) {
            return c.json({ error: 'invalid restore request' }, 400);
        }

        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request('https://do.local/restore', {
            method:  'POST',
            headers: {
                'Content-Type':    'application/json',
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
            body: JSON.stringify({ seq: parsed.data.seq }),
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/restructure — converge DO doc after templateSnapshot change (D8) ──
    // Called after the templateSnapshot PATCH has already landed in D1. The DO
    // re-reads the updated snapshot, diffs the current results keys, seeds
    // additions, removes deletions, persists, and broadcasts MSG_RESTORE so every
    // connected client drops its local state and resyncs. Reuses the same
    // fail-closed auth as /restore (no additional permission check needed).
    .post('/:id/collab/restructure', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const stub = collabStub(c, auth.tenantId, auth.inspectionId);
        const fwd = new Request('https://do.local/restructure', {
            method:  'POST',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    });

export default collabRoutes;
