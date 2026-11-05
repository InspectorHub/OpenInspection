/**
 * The widget beacon is public and writes a row per event. It is counted per caller address, what it can carry is bounded (a few short scalar
 * details), and the address on the row is never taken from the caller's own payload. Every refusal sits beside the request that goes through.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const ORIGIN = 'https://shop.example.test';

describe('POST /api/public/widget/event', () => {
    let h: Harness;
    let allow: boolean;
    let keys: string[];

    const send = async (body: unknown, origin: string | null = ORIGIN): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'widget-event-bounds' });
        const res = await app.request('/api/public/widget/event', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'CF-Connecting-IP': '203.0.113.9' },
            body: JSON.stringify(body),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const rows = () => h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityType, 'widget')).all();

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.update(schema.tenantConfigs).set({ widgetAllowedOrigins: [ORIGIN] }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
        allow = true;
        keys = [];
        (h.env as unknown as { RATE_LIMITER: unknown }).RATE_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow }; } };
    });
    afterEach(() => h.close());

    it('records a small event from an allowed origin, per caller address, with no address taken from the payload', async () => {
        const res = await send({ event: 'view', metadata: { page: 'book', ip: '10.9.8.7' } });
        expect(res.status).toBe(200);
        expect(keys).toContain('widget-event:203.0.113.9');
        const [row] = await rows();
        expect(row?.action).toBe('widget.view');
        expect(row?.ipAddress).toBeNull();
    });

    it('refuses with 429 and writes nothing when the limiter says stop', async () => {
        allow = false;
        expect((await send({ event: 'view' })).status).toBe(429);
        expect(await rows()).toEqual([]);
    });

    it('refuses details that are too many, too long, nested or the wrong kind, and writes nothing', async () => {
        const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']));
        for (const metadata of [tooMany, { note: 'x'.repeat(201) }, { nested: { a: 1 } }, { list: [1, 2] }, { ['k'.repeat(65)]: 'v' }]) {
            expect((await send({ event: 'view', metadata })).status, JSON.stringify(metadata).slice(0, 40)).toBe(400);
        }
        expect(await rows()).toEqual([]);
        // Control: ten short scalar details are accepted.
        const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i % 2 ? 'v' : i]));
        expect((await send({ event: 'view', metadata: ten })).status).toBe(200);
        expect(await rows()).toHaveLength(1);
    });

    it('still drops an event from an origin that is not allowed, with the same answer and no row', async () => {
        const res = await send({ event: 'view' }, 'https://attacker.example.test');
        expect(res.status).toBe(200);
        expect(await rows()).toEqual([]);
    });
});
