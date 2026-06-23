/**
 * Collab WebSocket route — GET /api/inspections/:id/collab/ws
 *
 * Authorization pattern mirrors the presence WS route
 * (server/api/inspections/core.ts, `.get('/:id/presence/ws', ...)`):
 *
 *   1. Require `Upgrade: websocket` — 426 otherwise.
 *   2. Feature-detect `env.INSPECTION_DOC` — 501 if absent.
 *   3. Resolve tenantId + userId from the JWT (set by the global auth
 *      middleware) — 401 if either is missing.
 *   4. Load the inspection via `services.inspection.getInspection(id, tenantId)`
 *      (tenant-scoped service call) — 404 if not found.
 *   5. Check that the caller is on the inspection (inspectorId /
 *      leadInspectorId / helperInspectorIds) — 403 otherwise.
 *   6. Forward the WS upgrade to the INSPECTION_DOC DO keyed by
 *      `${tenantId}:${id}`, passing tenantId + inspectionId as request
 *      headers (the DO reads them for observability; it trusts the route
 *      as the sole trust boundary).
 *
 * The route is mounted at `/` in the inspections aggregator
 * (server/api/inspections.ts), same as the other sub-routers.
 */

import { createApiRouter } from '../../lib/openapi-router';
import { logger } from '../../lib/logger';

const collabRoutes = createApiRouter()
    .get('/:id/collab/ws', async (c) => {
        // ── (1) WebSocket protocol check ──────────────────────────────────────
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket upgrade', { status: 426 });
        }

        // ── (2) Feature-detect binding ────────────────────────────────────────
        if (!c.env.INSPECTION_DOC) {
            return new Response('collab unavailable', { status: 501 });
        }

        const id = c.req.param('id');
        if (!id) return new Response('not found', { status: 404 });

        // ── (3) Auth — JWT claims only (never from client) ────────────────────
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;

        if (!tenantId || !userId) {
            return new Response('unauthorized', { status: 401 });
        }

        // ── (4) Inspection lookup — tenant-scoped ─────────────────────────────
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
            logger.error('collab ws: inspection lookup failed', { inspectionId: id, tenantId }, err instanceof Error ? err : undefined);
            return new Response('not found', { status: 404 });
        }

        // ── (5) Edit-permission check (mirrors presence route) ────────────────
        let helpers: string[] = [];
        try {
            const parsed = JSON.parse(inspection.helperInspectorIds ?? '[]');
            if (Array.isArray(parsed)) helpers = parsed as string[];
        } catch { /* malformed — treat as no helpers */ }

        const allowed =
            inspection.inspectorId   === userId ||
            inspection.leadInspectorId === userId ||
            helpers.includes(userId);

        if (!allowed) {
            return new Response('forbidden', { status: 403 });
        }

        // ── (6) Forward to the INSPECTION_DOC Durable Object ─────────────────
        const doId = c.env.INSPECTION_DOC.idFromName(`${tenantId}:${id}`);
        const stub = c.env.INSPECTION_DOC.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-tenant-id':      tenantId,
                'x-inspection-id':  id,
            },
        });

        return stub.fetch(fwd);
    });

export default collabRoutes;
