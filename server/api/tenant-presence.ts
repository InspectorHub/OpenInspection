/**
 * Design System 0520 subsystem B phase 2 task 2.5 — tenant-level presence
 * WebSocket upgrade.
 *
 * Single connection per dashboard tab — aggregates rosters across all
 * in-progress inspections for the tenant. See TenantPresenceDO for the
 * back-end behaviour.
 */
import {} from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';

const tenantPresenceRoutes = createApiRouter()
    .get('/presence/ws', async (c) => {
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }
        if (!c.env.TENANT_PRESENCE) {
            return new Response('presence unavailable', { status: 501 });
        }

        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!tenantId || !userId) return new Response('unauthorized', { status: 401 });

        const doId = c.env.TENANT_PRESENCE.idFromName(tenantId);
        const stub = c.env.TENANT_PRESENCE.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-user-id':        userId,
                'x-user-name':      'User',
                'x-user-photo-url': '',
            },
        });
        return stub.fetch(fwd);
    });

export type TenantPresenceApi = typeof tenantPresenceRoutes;

export default tenantPresenceRoutes;
