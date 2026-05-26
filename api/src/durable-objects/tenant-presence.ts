import { DurableObject } from 'cloudflare:workers';

/**
 * Design System 0520 subsystem B phase 2 task 2.4 — TenantPresenceDO.
 *
 * One instance per tenant (idFromName(tenantId)). Aggregates "who is
 * online" across in-progress inspections so the dashboard TeamStrip can
 * stream a single combined roster instead of opening N WebSockets per
 * inspection.
 *
 * Membership semantics (this MVP):
 *   - Inspectors who open this WS (via /api/tenant/presence/ws) appear as
 *     online in the tenant-roster broadcast.
 *   - The InspectionPresenceDO surfaces per-inspection roster updates via
 *     direct DO-to-DO fetch (`/inspection-roster` HTTP) when a roster
 *     changes; that hook lands in a follow-up under phase 7.
 *
 * Stored state: `tenantRoster` Map persists across hibernation cycles by
 * calling ctx.storage.put('state', …) on every mutation. The map is small
 * (one entry per active member) so storage cost is negligible.
 */

interface ClientAttachment {
    userId:        string;
    name:          string;
    photoUrl:      string | null;
    lastHeartbeat: number;
}

interface TenantMemberState {
    online:              boolean;
    currentInspectionId: string | null;
    lastSeenAt:          number;
}

interface TenantState {
    members: Record<string, TenantMemberState>;
}

const STALE_AFTER_MS = 90_000;

export class TenantPresenceDO extends DurableObject {
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname.endsWith('/ws')) {
            const userId   = req.headers.get('x-user-id');
            const name     = req.headers.get('x-user-name') ?? 'Unknown';
            const photoUrl = req.headers.get('x-user-photo-url') || null;
            if (!userId) return new Response('unauthorized', { status: 401 });

            if (req.headers.get('Upgrade') !== 'websocket') {
                return new Response('expected websocket', { status: 426 });
            }

            const pair = new WebSocketPair();
            const client = pair[0];
            const server = pair[1];

            const att: ClientAttachment = { userId, name, photoUrl, lastHeartbeat: Date.now() };
            server.serializeAttachment(att);
            this.ctx.acceptWebSocket(server);

            // Mark online + broadcast.
            await this.markOnline(userId);
            await this.broadcastRoster();
            return new Response(null, { status: 101, webSocket: client });
        }

        // Internal HTTP from InspectionPresenceDO when its per-inspection
        // roster changes — registers each user as "currently editing
        // <inspectionId>". The InspectionPresenceDO calls this via stub
        // fetch when its broadcastRoster fires.
        if (url.pathname.endsWith('/inspection-roster')) {
            const body = await req.json() as { inspectionId: string; users: Array<{ userId: string }> };
            const state = await this.readState();
            for (const u of body.users) {
                state.members[u.userId] = {
                    online: true,
                    currentInspectionId: body.inspectionId,
                    lastSeenAt: Date.now(),
                };
            }
            await this.ctx.storage.put('state', state);
            await this.broadcastRoster();
            return new Response('ok');
        }

        return new Response('not found', { status: 404 });
    }

    async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
        if (typeof raw !== 'string') return;
        let msg: { type?: string };
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg?.type === 'heartbeat') {
            const att = ws.deserializeAttachment() as ClientAttachment | null;
            if (!att) return;
            att.lastHeartbeat = Date.now();
            ws.serializeAttachment(att);
            const state = await this.readState();
            const entry = state.members[att.userId];
            if (entry) {
                entry.lastSeenAt = Date.now();
                entry.online = true;
                await this.ctx.storage.put('state', state);
            }
        }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        const att = ws.deserializeAttachment() as ClientAttachment | null;
        try { ws.close(); } catch { /* already closed */ }
        if (att) {
            const state = await this.readState();
            const entry = state.members[att.userId];
            if (entry) {
                entry.online = false;
                entry.lastSeenAt = Date.now();
                await this.ctx.storage.put('state', state);
            }
        }
        await this.broadcastRoster();
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        try { ws.close(1011, 'error'); } catch { /* already closed */ }
        await this.broadcastRoster();
    }

    private async readState(): Promise<TenantState> {
        const state = await this.ctx.storage.get<TenantState>('state');
        return state ?? { members: {} };
    }

    private async markOnline(userId: string): Promise<void> {
        const state = await this.readState();
        const existing = state.members[userId];
        state.members[userId] = {
            online:              true,
            currentInspectionId: existing?.currentInspectionId ?? null,
            lastSeenAt:          Date.now(),
        };
        await this.ctx.storage.put('state', state);
    }

    private async broadcastRoster(): Promise<void> {
        const state = await this.readState();
        // Reap stale members on every broadcast — keeps the surface small
        // and avoids a separate sweeper cron.
        const now = Date.now();
        let dirty = false;
        for (const [uid, m] of Object.entries(state.members)) {
            if (m.online && now - m.lastSeenAt > STALE_AFTER_MS) {
                state.members[uid] = { ...m, online: false };
                dirty = true;
            }
        }
        if (dirty) await this.ctx.storage.put('state', state);

        const payload = JSON.stringify({ type: 'tenant-roster', members: state.members });
        for (const ws of this.ctx.getWebSockets()) {
            try { ws.send(payload); } catch { /* already closed */ }
        }
    }
}
