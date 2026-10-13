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
 *      the inspection's roster) — 403 otherwise.
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

import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import {
    CollabFollowupRequestSchema, CollabRestoreRequestSchema, CollabSnapshotParamSchema,
    CollabTicketParamSchema, CollabTicketResponseSchema,
} from '../../lib/validations/collab.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { Errors } from '../../lib/errors';
import { issueWsTicket, WS_TICKET_TTL_S } from '../../lib/native/ws-ticket';
import { getDrizzle } from '../../lib/route-helpers';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../../lib/db/schema';
import { parseReinspectionStatuses } from '../../lib/reinspection-status';
import { forwardCollabImport } from '../../lib/collab/import-route';
import { authorizeCollab, collabStub } from '../../lib/collab/authorize';

const issueCollabTicketRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/collab/ticket', operationId: 'issueCollabTicket', tags: ['client'],
    summary: 'Issue a one-time WebSocket ticket',
    description: 'Exchanges the signed-in native client identity for a single-use ticket, valid for sixty seconds and for one inspection, which authenticates the collab or presence WebSocket upgrade through the ticket query parameter because a WebView socket cannot send an Authorization header.',
    request: { params: CollabTicketParamSchema },
    responses: { 200: { description: 'One-time ticket', content: { 'application/json': { schema: CollabTicketResponseSchema } } } },
}, { scopes: ['write'], tier: 'excluded' }));

const collabRoutes = createApiRouter()
    // Native identity only, and the same checks as the socket itself: a ticket is
    // never issued for an inspection the caller could not open.
    .openapi(issueCollabTicketRoute, async (c) => {
        if (!c.get('nativeClient')) throw Errors.Unauthorized('Native session required');
        const auth = await authorizeCollab(c);
        if (!auth.ok) {
            const { status } = auth.response;
            if (status === 403) throw Errors.Forbidden();
            if (status === 404) throw Errors.NotFound();
            if (status === 501) throw Errors.ServiceUnavailable('Collaboration is unavailable');
            throw Errors.Unauthorized();
        }
        const kv = c.env.TENANT_CACHE;
        if (!kv) throw Errors.ServiceUnavailable('Ticket storage is unavailable');
        // Role comes from the identity the middleware verified, never from the request.
        const role = c.get('userRole');
        if (!role) throw Errors.Unauthorized();
        const ticket = await issueWsTicket(kv, {
            tenantId: auth.tenantId, userId: auth.userId, role, inspectionId: auth.inspectionId,
        });
        return c.json({ success: true as const, data: { ticket, expiresIn: WS_TICKET_TTL_S } }, 200);
    })
    .get('/:id/collab/ws', async (c) => {
        // ── (0) WebSocket protocol check (ws-only) ────────────────────────────
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket upgrade', { status: 426 });
        }

        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        // ── Forward the WS upgrade to the INSPECTION_DOC Durable Object ────────
        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':         'websocket',
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── GET /:id/collab/snapshots — list version history ──────────────────────
    .get('/:id/collab/snapshots', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/snapshots', {
            method:  'GET',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
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

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request(`https://do.local/snapshots/${parsedParam.data.seq}`, {
            method:  'GET',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/snapshots — capture an on-demand snapshot ─────────────
    .post('/:id/collab/snapshots', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/snapshots', {
            method:  'POST',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
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

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/restore', {
            method:  'POST',
            headers: {
                'Content-Type':    'application/json',
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
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

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/restructure', {
            method:  'POST',
            headers: {
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
                'x-user-id':       auth.userId,
            },
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/followup — record a carried item's follow-up verdict ──
    // #119. The one write this feature was missing: `createReinspection` seeds
    // every carried item with `followupStatus: null`, the report renders it and
    // the next round's pre-selection is computed from it, and until now no
    // surface could set it. It travels through the DO rather than straight to D1
    // because the Y.Doc is the only write path for a finding — see
    // `server/lib/collab/followup-patch.ts`.
    //
    // Same fail-closed auth as /restore: whoever may edit the document may
    // record the verdict, which is the same permission the rating buttons carry.
    .post('/:id/collab/followup', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;

        let parsedBody: unknown;
        try {
            parsedBody = await c.req.json();
        } catch {
            return c.json({ error: 'invalid JSON body' }, 400);
        }
        const parsed = CollabFollowupRequestSchema.safeParse(parsedBody);
        if (!parsed.success) {
            return c.json({ error: 'invalid follow-up request' }, 400);
        }

        // The VOCABULARY IS THE TENANT'S, and it is checked here rather than in
        // the document: a key outside the workspace's set would be stored
        // faithfully and then read as "still open" by `isOpenStatus`, which is a
        // wrong answer that looks like a deliberate one. Refusing it names the
        // keys, so a client whose list has drifted learns what the set is.
        if (parsed.data.status !== null) {
            const row = await getDrizzle(c)
                .select({ s: tenantConfigs.reinspectionStatuses })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, auth.tenantId))
                .get();
            const allowed = parseReinspectionStatuses(row?.s ?? null);
            if (!allowed.some((s) => s.key === parsed.data.status)) {
                return c.json(
                    { error: 'unknown follow-up status', allowed: allowed.map((s) => s.key) },
                    400,
                );
            }
        }

        const stub = collabStub(c, auth.tenantId, auth.reportId);
        const fwd = new Request('https://do.local/followup', {
            method:  'POST',
            headers: {
                'Content-Type':    'application/json',
                'x-tenant-id':     auth.tenantId,
                'x-inspection-id': auth.inspectionId,
                'x-report-id':     auth.reportId,
                'x-user-id':       auth.userId,
            },
            body: JSON.stringify(parsed.data),
        });
        return stub.fetch(fwd);
    })
    // ── POST /:id/collab/import — apply an offline client's Yjs update ─────────
    // Raw bytes, so no zod body schema; see `forwardCollabImport` for how the
    // size is bounded. The DO snapshots first and refuses what it cannot undo.
    // Idempotent by construction: re-applying a Yjs update changes nothing, so
    // a retry after any failure is safe without an Idempotency-Key.
    .post('/:id/collab/import', async (c) => {
        const auth = await authorizeCollab(c);
        if (!auth.ok) return auth.response;
        return forwardCollabImport(c, { ...auth, stub: collabStub(c, auth.tenantId, auth.reportId) });
    });

export default collabRoutes;
