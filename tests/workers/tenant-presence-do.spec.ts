/**
 * TenantPresenceDO (workerd): the company-wide roster names the inspection each colleague has open.
 * A connection the worker stamped as restricted must never receive that id; an unrestricted one must
 * (the control that proves the redaction is not simply a dead feature).
 */
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { TenantPresenceDO } from '../../server/durable-objects/tenant-presence';

const b = env as unknown as { TENANT_PRESENCE: DurableObjectNamespace<TenantPresenceDO> };

interface Frame { type: string; members: Record<string, { online: boolean; currentInspectionId: string | null }> }

function upgrade(userId: string, scope: 'all' | 'assigned'): Request {
    return new Request('https://do.local/ws', {
        headers: { Upgrade: 'websocket', 'x-user-id': userId, 'x-user-name': userId, 'x-inspection-scope': scope },
    });
}

function capture(ws: WebSocket): Frame[] {
    const frames: Frame[] = [];
    ws.accept();
    ws.addEventListener('message', (e: MessageEvent) => {
        if (typeof e.data !== 'string') return;
        try { const m = JSON.parse(e.data) as Frame; if (m.type === 'tenant-roster') frames.push(m); } catch { /* ignore */ }
    });
    return frames;
}

async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try { assertion(); return; } catch (err) {
            if (Date.now() >= deadline) throw err;
            await new Promise((r) => setTimeout(r, 10));
        }
    }
}

describe('TenantPresenceDO — roster frames per viewer (workerd)', () => {
    it('a restricted viewer is not told which inspection a colleague has open; an unrestricted one is', async () => {
        const stub = b.TENANT_PRESENCE.get(b.TENANT_PRESENCE.idFromName('tenant-' + crypto.randomUUID().slice(0, 8)));
        const open = await stub.fetch(upgrade('viewer-all', 'all'));
        const restricted = await stub.fetch(upgrade('viewer-restricted', 'assigned'));
        expect(open.status).toBe(101);
        expect(restricted.status).toBe(101);
        const openFrames = capture(open.webSocket!);
        const restrictedFrames = capture(restricted.webSocket!);

        const res = await stub.fetch(new Request('https://do.local/inspection-roster', {
            method: 'POST',
            body: JSON.stringify({ inspectionId: 'i-secret', users: [{ userId: 'colleague' }] }),
        }));
        expect(res.status).toBe(200);

        await waitFor(() => {
            expect(openFrames.at(-1)?.members.colleague?.currentInspectionId).toBe('i-secret');
            expect(restrictedFrames.at(-1)?.members.colleague).toBeDefined();
        });
        expect(restrictedFrames.at(-1)?.members.colleague?.currentInspectionId).toBeNull();
        expect(JSON.stringify(restrictedFrames)).not.toContain('i-secret');
        // Online state still reaches the restricted viewer: the colleague roster is company-level.
        expect(restrictedFrames.at(-1)?.members.colleague?.online).toBe(true);
    });

    it('a connection with no scope header is treated as restricted (fails closed)', async () => {
        const stub = b.TENANT_PRESENCE.get(b.TENANT_PRESENCE.idFromName('tenant-' + crypto.randomUUID().slice(0, 8)));
        const resp = await stub.fetch(new Request('https://do.local/ws', {
            headers: { Upgrade: 'websocket', 'x-user-id': 'viewer-unlabelled', 'x-user-name': 'v' },
        }));
        const frames = capture(resp.webSocket!);
        await stub.fetch(new Request('https://do.local/inspection-roster', {
            method: 'POST',
            body: JSON.stringify({ inspectionId: 'i-secret-2', users: [{ userId: 'colleague' }] }),
        }));
        await waitFor(() => expect(frames.at(-1)?.members.colleague).toBeDefined());
        expect(JSON.stringify(frames)).not.toContain('i-secret-2');
    });
});
