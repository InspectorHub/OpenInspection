/**
 * The other reads every workspace page leans on, counted in sequential D1 round
 * trips the same way the dashboard is (see dashboard-round-trips.spec.ts).
 *
 * Each of these read their pieces one after another. Measured warm, in waves
 * (middleware wave included): usage summary 4, templates list 4, services list
 * 3, tags list 3. Every piece they read is independent of the others, so the
 * floor is two: the middleware's own wave, then everything the route needs.
 *
 * The answers are asserted too, against values worked out from the fixture, so
 * a faster route that quietly changed what it returns fails here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, type Harness } from '../helpers/tenant-email-harness';
import { recordRoundTrips } from '../helpers/round-trip-recorder';

const LATENCY_MS = 25;

async function get(h: Harness, path: string) {
    const rec = recordRoundTrips(h.env.DB as D1Database, LATENCY_MS);
    (h.env as unknown as Record<string, unknown>).DB = rec.binding;
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat, exp: iat + 3600 }, keyring);
    const call = async () => {
        const exec = makeExecutionContext({ label: path });
        const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    await call();
    await call(); // warm the middleware caches; see the dashboard spec for why two
    rec.reset();
    const res = await call();
    const body = await res.json() as { data?: unknown; meta?: { total?: number } };
    console.log(`${path.split('?')[0]}: status=${res.status} statements=${rec.log.statements} roundTrips=${rec.log.roundTrips} waves=${rec.log.waves} budget=2`);
    expect(rec.log.statements, 'the recorder counted nothing - the instrument is broken').toBeGreaterThan(0);
    return { status: res.status, body, waves: rec.log.waves };
}

describe('read routes wait for at most two sequential round trips', () => {
    let h: Harness;
    afterEach(() => h?.close());

    async function harness(): Promise<Harness> {
        h = await createHarness('standalone');
        await h.db.update(schema.users).set({ slug: 'olive' } as never).where(eq(schema.users.id, OWNER_ID));
        return h;
    }

    it('usage summary', async () => {
        await harness();
        const r = await get(h, '/api/usage/summary');
        expect(r.status).toBe(200);
        // Two members (the owner and the inspector), no invitations outstanding.
        expect((r.body.data as { usage: { seatsUsed: number } }).usage.seatsUsed).toBe(2);
        expect(r.waves).toBeLessThanOrEqual(2);
    });

    it('tags list, first run seeds the canonical tags and later runs read them back', async () => {
        await harness();
        const r = await get(h, '/api/tags');
        expect(r.status).toBe(200);
        const names = (r.body.data as Array<{ name: string; isSeed: boolean }>).map((t) => t.name);
        expect(names.length).toBe(5);
        expect(new Set(names).size).toBe(5);
        // Seeded tags are not duplicated by the repeat reads that warmed the caches.
        expect(await h.db.select().from(schema.tags).all()).toHaveLength(5);
        expect(r.waves).toBeLessThanOrEqual(2);
    });

    it('services list', async () => {
        await harness();
        await h.db.insert(schema.services).values({ id: 'svc-1', tenantId: TENANT_ID, name: 'Full inspection', price: 45000, createdAt: new Date() } as never);
        const r = await get(h, '/api/services');
        expect(r.status).toBe(200);
        expect((r.body.data as Array<{ id: string; price?: number }>).map((s) => [s.id, s.price])).toEqual([['svc-1', 45000]]);
        expect(r.waves).toBeLessThanOrEqual(2);
    });

    it('templates list', async () => {
        await harness();
        await h.db.insert(schema.templates).values([1, 2, 3].map((n) => ({
            id: `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`, tenantId: TENANT_ID, name: `Template ${n}`, version: 1, schema: '{"sections":[]}', createdAt: new Date(1_700_000_000_000 + n),
        })) as never);
        const r = await get(h, '/api/inspections/templates?page=1&pageSize=12');
        expect(r.status).toBe(200);
        expect(r.body.meta?.total).toBe(3);
        expect((r.body.data as Array<{ name: string }>).map((t) => t.name)).toEqual(['Template 3', 'Template 2', 'Template 1']);
        expect(r.waves).toBeLessThanOrEqual(2);
    });
});
