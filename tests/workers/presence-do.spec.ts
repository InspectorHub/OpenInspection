/**
 * InspectionPresenceDO — real-runtime (workerd) roster broadcast.
 *
 * Replaces the node-env placeholder in tests/unit/inspection-presence-do.spec.ts
 * (which could only do a static class-name check — the DO imports
 * `cloudflare:workers`, unavailable in the node pool). Here the DO runs in the
 * real workerd isolate via the vitest-pool-workers binding, so we drive its
 * actual WebSocket hibernation + `broadcastRoster()` path.
 *
 * Protocol (see inspection-presence.ts): a `/ws` upgrade carrying x-user-* headers
 * is accepted; on every roster change the DO broadcasts `{ type:'roster', users }`
 * to all live connections. We assert:
 *   1. A second client joining broadcasts an updated roster to the FIRST client.
 *   2. The DO's own roster state lists both connections.
 *   3. Closing a connection broadcasts a roster without the departed user.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { InspectionPresenceDO } from '../../server/durable-objects/inspection-presence';

interface TestBindings {
    INSPECTION_PRESENCE: DurableObjectNamespace<InspectionPresenceDO>;
}
const b = env as unknown as TestBindings;

interface RosterMsg { type: 'roster'; users: Array<{ userId: string; role: string; focusItemId: string | null }> }
interface PresenceInternals { snapshotRoster(): Array<{ userId: string }> }

/** Build a `/ws` upgrade request with the identity headers the worker stamps. */
function wsUpgrade(userId: string, name: string, role: 'inspector' | 'observer' = 'inspector'): Request {
    return new Request('https://do.local/api/inspections/x/presence/ws', {
        headers: {
            Upgrade: 'websocket',
            'x-user-id': userId,
            'x-user-name': name,
            'x-user-role': role,
        },
    });
}

/** Accept the client end of a DO-returned WebSocket and collect roster frames. */
function captureRosters(ws: WebSocket): RosterMsg[] {
    const frames: RosterMsg[] = [];
    ws.accept();
    ws.addEventListener('message', (e: MessageEvent) => {
        if (typeof e.data !== 'string') return;
        try {
            const m = JSON.parse(e.data);
            if (m && m.type === 'roster') frames.push(m as RosterMsg);
        } catch { /* ignore non-JSON */ }
    });
    return frames;
}

const flush = () => new Promise((r) => setTimeout(r, 50));
const ids = (m: RosterMsg | undefined) => (m?.users ?? []).map((u) => u.userId).sort();

describe('InspectionPresenceDO — roster broadcast (workerd)', () => {
    it('broadcasts the updated roster to an existing client when a new client joins', async () => {
        const inspectionId = 'presence-join-' + crypto.randomUUID().slice(0, 8);
        const stub = b.INSPECTION_PRESENCE.get(b.INSPECTION_PRESENCE.idFromName(inspectionId));

        // Client A joins; start capturing AFTER the open so we observe the
        // broadcast triggered by B's later join (A's own-join frame may predate
        // the listener — that path is covered by the snapshotRoster assertion).
        const respA = await stub.fetch(wsUpgrade('uA', 'Alice'));
        expect(respA.status).toBe(101);
        const aFrames = captureRosters(respA.webSocket!);

        // Client B joins → DO broadcasts roster [A, B] to every connection.
        const respB = await stub.fetch(wsUpgrade('uB', 'Bob'));
        expect(respB.status).toBe(101);
        respB.webSocket!.accept();

        await flush();

        // A received a roster broadcast naming both users.
        expect(aFrames.length).toBeGreaterThan(0);
        expect(ids(aFrames[aFrames.length - 1])).toEqual(['uA', 'uB']);

        // The DO's own roster state lists both live connections.
        await runInDurableObject(stub, async (instance: InspectionPresenceDO) => {
            const roster = (instance as unknown as PresenceInternals).snapshotRoster();
            expect(roster.map((u) => u.userId).sort()).toEqual(['uA', 'uB']);
        });
    });

    it('broadcasts a roster without the departed user when a connection closes', async () => {
        const inspectionId = 'presence-leave-' + crypto.randomUUID().slice(0, 8);
        const stub = b.INSPECTION_PRESENCE.get(b.INSPECTION_PRESENCE.idFromName(inspectionId));

        const respA = await stub.fetch(wsUpgrade('uA', 'Alice'));
        const aWs = respA.webSocket!;
        const aFrames = captureRosters(aWs);

        const respB = await stub.fetch(wsUpgrade('uB', 'Bob'));
        const bWs = respB.webSocket!;
        bWs.accept();
        await flush();
        expect(ids(aFrames[aFrames.length - 1])).toEqual(['uA', 'uB']);

        // B leaves → webSocketClose fires → broadcastRoster to remaining (A).
        bWs.close(1000, 'bye');
        await flush();

        expect(ids(aFrames[aFrames.length - 1])).toEqual(['uA']);

        await runInDurableObject(stub, async (instance: InspectionPresenceDO) => {
            const roster = (instance as unknown as PresenceInternals).snapshotRoster();
            expect(roster.map((u) => u.userId)).toEqual(['uA']);
        });
    });

    it('rejects a WS upgrade with no x-user-id (worker-stamped identity required)', async () => {
        const inspectionId = 'presence-auth-' + crypto.randomUUID().slice(0, 8);
        const stub = b.INSPECTION_PRESENCE.get(b.INSPECTION_PRESENCE.idFromName(inspectionId));
        const resp = await stub.fetch(new Request('https://do.local/presence/ws', {
            headers: { Upgrade: 'websocket', 'x-user-name': 'NoId' },
        }));
        expect(resp.status).toBe(401);
    });
});
