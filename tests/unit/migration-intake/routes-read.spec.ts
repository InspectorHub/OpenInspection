/**
 * Reading import runs back: the list, and one run's report.
 *
 * Both are read-only and both are tenant-scoped, which is the whole of what
 * there is to get wrong here. The scoping is asserted the only way that proves
 * anything — the SAME id, requested by the tenant that owns it and by one that
 * does not, with opposite outcomes. A 404 on its own would also be produced by
 * a typo in the query.
 *
 * Split from routes-create.spec.ts rather than sharing its file: the POST spec
 * carries a multipart harness and an R2 double that nothing here needs, and one
 * file holding both crosses the 400-line cap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import migrationIntakeRoutes from '../../../server/api/migration-intake';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER = '33333333-3333-3333-3333-3333333333c3';
const USER = '22222222-2222-2222-2222-2222222222b2';

function appFor(role: string, tenantId = TENANT) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', tenantId);
        c.set('user', { sub: USER, role: role as 'owner' });
        c.set('userRole', role as 'owner');
        // Standalone so `blockedReason` never reaches the seat-quota query,
        // which wants a real D1 handle rather than the drizzle double.
        c.set('profile', STANDALONE_PROFILE);
        await next();
    });
    app.route('/api/imports', migrationIntakeRoutes);
    return app;
}

function get(path: string, role = 'owner', tenantId = TENANT) {
    return appFor(role, tenantId).request(path, { method: 'GET' }, { DB: {}, PHOTOS: {} });
}

describe('GET /api/imports', () => {
    let db: BetterSQLite3Database<typeof schema>;

    async function seedBatch(id: string, tenantId: string, createdAt: Date) {
        await db.insert(schema.migrationBatches).values({
            id, tenantId, createdBy: USER, intent: 'contacts.import',
            vendor: 'csv_generic', adapterName: 'csv-generic', adapterVersion: '1',
            manifest: '{"warnings":[]}', createdAt,
        });
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        for (const id of [TENANT, OTHER]) {
            await db.insert(schema.tenants).values({
                id, slug: id.slice(0, 8), status: 'active', deploymentMode: 'shared',
                tier: 'free', createdAt: new Date(),
            });
        }
    });

    it("lists this tenant's runs newest first and nobody else's", async () => {
        await seedBatch('b1', TENANT, new Date(1_000));
        await seedBatch('b2', TENANT, new Date(2_000));
        await seedBatch('b3', OTHER, new Date(3_000));

        const res = await get('/api/imports');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { items: { id: string }[] } };
        expect(body.data.items.map((i) => i.id)).toEqual(['b2', 'b1']);
    });

    it("returns the other tenant's run to the other tenant", async () => {
        // Positive control for the exclusion above: 'b3' is a real, readable
        // row, so its absence from the list is scoping and not a missing insert.
        await seedBatch('b3', OTHER, new Date(3_000));
        const res = await get('/api/imports', 'owner', OTHER);
        const body = await res.json() as { data: { items: { id: string }[] } };
        expect(body.data.items.map((i) => i.id)).toEqual(['b3']);
    });

    it('honours the requested page size', async () => {
        await seedBatch('b1', TENANT, new Date(1_000));
        await seedBatch('b2', TENANT, new Date(2_000));
        const res = await get('/api/imports?limit=1');
        const body = await res.json() as { data: { items: { id: string }[] } };
        expect(body.data.items.map((i) => i.id)).toEqual(['b2']);
    });

    it('reports the timestamps as ISO strings and the missing expiry as null', async () => {
        await seedBatch('b1', TENANT, new Date(1_000));
        const res = await get('/api/imports');
        const body = await res.json() as {
            data: { items: { createdAt: string; expiresAt: string | null; status: string }[] };
        };
        expect(body.data.items[0].createdAt).toBe(new Date(1_000).toISOString());
        expect(body.data.items[0].expiresAt).toBeNull();
        expect(body.data.items[0].status).toBe('staged');
    });

    it('keeps an inspector out of the list', async () => {
        const res = await get('/api/imports', 'inspector');
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toBe('Requires one of [owner, manager]');
    });
});

describe('GET /api/imports/{batchId}', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        for (const id of [TENANT, OTHER]) {
            await db.insert(schema.tenants).values({
                id, slug: id.slice(0, 8), status: 'active', deploymentMode: 'shared',
                tier: 'free', createdAt: new Date(),
            });
        }
        await db.insert(schema.migrationBatches).values({
            id: 'b1', tenantId: OTHER, createdBy: USER, intent: 'contacts.import',
            vendor: 'csv_generic', adapterName: 'csv-generic', adapterVersion: '1',
            manifest: '{"warnings":[]}', createdAt: new Date(1_000),
        });
        await db.insert(schema.migrationRows).values({
            id: 'r1', batchId: 'b1', tenantId: OTHER, entity: 'contact', position: 0,
            payload: JSON.stringify({ name: 'Alice Ng', email: 'alice@example.test', type: 'client' }),
            // No `createdAt` here: `migration_rows` has no such column. Its only
            // time column is `applied_at`, which a pending row has not reached.
            status: 'pending',
        });
    });

    it('reads back the counts and the run it belongs to', async () => {
        const res = await get('/api/imports/b1', 'owner', OTHER);
        expect(res.status).toBe(200);
        const body = await res.json() as {
            data: {
                batch: { id: string; intent: string };
                counts: { total: number; ok: number; conflicts: number; problems: number };
                blockedReason: string | null;
            };
        };
        expect(body.data.batch.id).toBe('b1');
        expect(body.data.batch.intent).toBe('contacts.import');
        expect(body.data.counts).toEqual({ total: 1, ok: 1, conflicts: 0, problems: 0 });
        expect(body.data.blockedReason).toBeNull();
    });

    it('does not read a run belonging to another workspace', async () => {
        // The SAME id the test above reads successfully. That pairing is what
        // makes this a scoping assertion rather than a spelling one.
        const res = await get('/api/imports/b1', 'owner', TENANT);
        expect(res.status).toBe(404);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toBe('Migration batch not found');
    });

    it('passes the page window through to the report', async () => {
        const res = await get('/api/imports/b1?page=2&pageSize=5', 'owner', OTHER);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { page: number; pageSize: number } };
        expect(body.data.page).toBe(2);
        expect(body.data.pageSize).toBe(5);
    });

    it('keeps an inspector out of the report', async () => {
        const res = await get('/api/imports/b1', 'inspector', OTHER);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toBe('Requires one of [owner, manager]');
    });
});
