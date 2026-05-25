import { DurableObject } from 'cloudflare:workers';

/**
 * Design System 0520 subsystem B phase 2 task 2.3 — InspectionPresenceDO.
 *
 * One Durable Object instance per inspection (idFromName(inspectionId)).
 * Uses the WebSocket Hibernation API so the worker can sleep between
 * messages — roster state lives in WebSocket attachments, not JS memory.
 *
 * Authentication is the worker's responsibility: by the time a WS upgrade
 * reaches this DO via stub.fetch(), the worker has already verified the
 * JWT and stamped the user identity into request headers. The DO trusts
 * those headers.
 *
 * Message protocol (see public/js/presence-protocol.{js,d.ts}):
 *
 *   C → S   hello       { userId, name, photoUrl }   — sent right after open
 *   C → S   heartbeat   {}                            — every 30s
 *   C → S   focus       { itemId: string | null }    — when user switches item
 *   C → S   bye         {}                            — explicit unload
 *   S → C   roster      { users: Connection[] }      — broadcast on state change
 *
 * Liveness: drop connections whose lastHeartbeat is older than 90s on
 * each broadcast pass. Client retries with exponential backoff (see
 * /js/presence-client.js).
 */

interface Attachment {
    userId:        string;
    name:          string;
    photoUrl:      string | null;
    role:          'inspector' | 'observer';
    focusItemId:   string | null;
    joinedAt:      number;
    lastHeartbeat: number;
}

interface PublicRosterEntry {
    userId:      string;
    name:        string;
    photoUrl:    string | null;
    role:        'inspector' | 'observer';
    focusItemId: string | null;
    joinedAt:    number;
}

const STALE_AFTER_MS = 90_000;

export class InspectionPresenceDO extends DurableObject {
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        // WebSocket upgrade — forwarded by the worker's /api/inspections/:id/presence/ws route.
        if (url.pathname.endsWith('/ws')) {
            const userId   = req.headers.get('x-user-id');
            const name     = req.headers.get('x-user-name') ?? 'Unknown';
            const photoUrl = req.headers.get('x-user-photo-url') || null;
            const role     = (req.headers.get('x-user-role') === 'observer') ? 'observer' : 'inspector';
            if (!userId) return new Response('unauthorized', { status: 401 });

            if (req.headers.get('Upgrade') !== 'websocket') {
                return new Response('expected websocket', { status: 426 });
            }

            const pair = new WebSocketPair();
            const client = pair[0];
            const server = pair[1];

            const attachment: Attachment = {
                userId,
                name,
                photoUrl,
                role,
                focusItemId: null,
                joinedAt: Date.now(),
                lastHeartbeat: Date.now(),
            };
            server.serializeAttachment(attachment);
            this.ctx.acceptWebSocket(server);

            // Broadcast the new roster — the joining client receives it as
            // its first server message, alongside every other connection.
            this.broadcastRoster();

            return new Response(null, { status: 101, webSocket: client });
        }

        // Internal HTTP — used by TenantPresenceDO to pull current roster.
        if (url.pathname.endsWith('/roster')) {
            return Response.json({ roster: this.snapshotRoster() });
        }

        return new Response('not found', { status: 404 });
    }

    async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
        if (typeof raw !== 'string') return;
        let msg: { type?: string; itemId?: unknown };
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }
        if (!msg || typeof msg.type !== 'string') return;

        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;

        if (msg.type === 'heartbeat') {
            att.lastHeartbeat = Date.now();
            ws.serializeAttachment(att);
            return;
        }

        if (msg.type === 'focus') {
            // Observers are read-only and never broadcast focus.
            if (att.role === 'observer') return;
            att.focusItemId = typeof msg.itemId === 'string' ? msg.itemId : null;
            att.lastHeartbeat = Date.now();
            ws.serializeAttachment(att);
            this.broadcastRoster();
            return;
        }

        if (msg.type === 'bye') {
            try { ws.close(1000, 'bye'); } catch { /* socket already gone */ }
            return;
        }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        try { ws.close(); } catch { /* already closed */ }
        this.broadcastRoster();
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        try { ws.close(1011, 'error'); } catch { /* already closed */ }
        this.broadcastRoster();
    }

    private snapshotRoster(): PublicRosterEntry[] {
        const out: PublicRosterEntry[] = [];
        const now = Date.now();
        for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as Attachment | null;
            if (!att) continue;
            if (now - att.lastHeartbeat > STALE_AFTER_MS) {
                // Reap stale connection — close + skip from snapshot.
                try { ws.close(1000, 'stale'); } catch { /* already closed */ }
                continue;
            }
            out.push({
                userId:      att.userId,
                name:        att.name,
                photoUrl:    att.photoUrl,
                role:        att.role,
                focusItemId: att.focusItemId,
                joinedAt:    att.joinedAt,
            });
        }
        return out;
    }

    private broadcastRoster(): void {
        const roster = this.snapshotRoster();
        const payload = JSON.stringify({ type: 'roster', users: roster });
        for (const ws of this.ctx.getWebSockets()) {
            try { ws.send(payload); } catch { /* already closed */ }
        }
    }
}
