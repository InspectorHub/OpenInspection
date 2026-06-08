import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import { erasureLog } from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

/**
 * Track I-a G4 — compliance settings endpoints.
 *
 *  1. PATCH /api/admin/tenant-config now carries `agreementRetentionYears`
 *     (integer 1–99; reject otherwise with 400).
 *  2. GET /api/admin/compliance/erasure-log — recent erasure_log rows for the
 *     tenant, newest first, tenant-scoped, no token material / no PII beyond
 *     subject_email (which the admin already sees when initiating an erasure).
 *
 * The erasure-log handler calls `drizzle(c.env.DB)` directly, so we mock
 * drizzle-orm/d1 to return our better-sqlite3 test DB instance (same idiom as
 * bookings-company-endpoints.spec.ts).
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import admin routes AFTER the mock is set up.
// eslint-disable-next-line import/order
import adminRoutes from '../../server/api/admin';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_TENANT = 'bbbbbbbb-0000-0000-0000-000000000002';

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    brandingStubs: { updateBranding?: ReturnType<typeof vi.fn> } = {},
) {
    const app = new OpenAPIHono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json(
                { success: false, error: { code: err.code, message: err.message } },
                err.status,
            );
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT_ID);
        c.set('services', {
            branding: {
                updateBranding: brandingStubs.updateBranding ?? vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    (mockDrizzle as any).mockReturnValue(db);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'x' } as unknown as HonoConfig['Bindings'];

/** Minimal ExecutionContext stub — auditFromContext reads c.executionCtx. */
const EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** Like app.request but threads an ExecutionContext (production always has one). */
function request(app: OpenAPIHono<HonoConfig>, url: string, init: RequestInit = {}) {
    return app.fetch(new Request(`http://local${url}`, init), ENV, EXEC_CTX);
}

describe('PATCH /api/admin/tenant-config — agreementRetentionYears (G4)', () => {
    it('persists a valid retention year (1–99) via branding.updateBranding', async () => {
        const { sqlite, db } = createTestDb();
        await setupSchema(sqlite);
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const app = buildApp(db, { updateBranding });

        const res = await request(app, '/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agreementRetentionYears: 7 }),
        });

        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith(TENANT_ID, { agreementRetentionYears: 7 });
        sqlite.close();
    });

    it('accepts the boundaries 1 and 99', async () => {
        const { sqlite, db } = createTestDb();
        await setupSchema(sqlite);
        for (const yrs of [1, 99]) {
            const updateBranding = vi.fn().mockResolvedValue(undefined);
            const app = buildApp(db, { updateBranding });
            const res = await request(app, '/api/admin/tenant-config', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ agreementRetentionYears: yrs }),
            });
            expect(res.status).toBe(200);
            expect(updateBranding).toHaveBeenCalledWith(TENANT_ID, { agreementRetentionYears: yrs });
        }
        sqlite.close();
    });

    it.each([0, -1, 100, 6.5])('rejects out-of-range / non-integer %s with 400', async (bad) => {
        const { sqlite, db } = createTestDb();
        await setupSchema(sqlite);
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const app = buildApp(db, { updateBranding });
        const res = await request(app, '/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agreementRetentionYears: bad }),
        });
        expect(res.status).toBe(400);
        expect(updateBranding).not.toHaveBeenCalled();
        sqlite.close();
    });
});

describe('GET /api/admin/compliance/erasure-log (G4)', () => {
    let sqlite: any;
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const t = createTestDb();
        sqlite = t.sqlite;
        db = t.db;
        await setupSchema(sqlite);
    });

    afterEach(() => sqlite.close());

    async function seedRow(over: Partial<typeof erasureLog.$inferInsert> = {}) {
        await db.insert(erasureLog).values({
            id: over.id ?? crypto.randomUUID(),
            tenantId: over.tenantId ?? TENANT_ID,
            subjectEmail: over.subjectEmail ?? 'client@example.com',
            requestedBy: over.requestedBy ?? 'user-1',
            identityBasis: over.identityBasis ?? 'admin_action',
            status: over.status ?? 'completed',
            decisionsJson: over.decisionsJson ?? JSON.stringify([{ table: 'agreements', action: 'delete', count: 2 }]),
            retainedCount: over.retainedCount ?? 1,
            anonymizedCount: over.anonymizedCount ?? 0,
            deletedCount: over.deletedCount ?? 2,
            responseNote: over.responseNote ?? null,
            createdAt: over.createdAt ?? Date.now(),
        });
    }

    it('returns recent rows for the tenant, newest first, with parsed decisions', async () => {
        await seedRow({ subjectEmail: 'old@example.com', createdAt: 1000 });
        await seedRow({ subjectEmail: 'new@example.com', createdAt: 2000 });
        const app = buildApp(db);

        const res = await request(app, '/api/admin/compliance/erasure-log');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<Record<string, unknown>> };
        expect(body.data.length).toBe(2);
        // Newest first.
        expect(body.data[0].subjectEmail).toBe('new@example.com');
        expect(body.data[1].subjectEmail).toBe('old@example.com');
        // Shape: counts + status + parsed decisions array.
        const row = body.data[0];
        expect(row.status).toBe('completed');
        expect(row.deletedCount).toBe(2);
        expect(row.retainedCount).toBe(1);
        expect(row.anonymizedCount).toBe(0);
        expect(Array.isArray(row.decisions)).toBe(true);
        expect((row.decisions as unknown[])[0]).toMatchObject({ table: 'agreements', action: 'delete', count: 2 });
    });

    it('is tenant-scoped — rows from other tenants are excluded', async () => {
        await seedRow({ subjectEmail: 'mine@example.com', tenantId: TENANT_ID });
        await seedRow({ subjectEmail: 'theirs@example.com', tenantId: OTHER_TENANT });
        const app = buildApp(db);

        const res = await request(app, '/api/admin/compliance/erasure-log');
        const body = await res.json() as { data: Array<{ subjectEmail: string }> };
        expect(body.data.map((r) => r.subjectEmail)).toEqual(['mine@example.com']);
    });

    it('exposes no token material and no PII fields beyond subjectEmail', async () => {
        await seedRow();
        const app = buildApp(db);
        const res = await request(app, '/api/admin/compliance/erasure-log');
        const body = await res.json() as { data: Array<Record<string, unknown>> };
        const row = body.data[0];
        const keys = Object.keys(row);
        // Allow-list of fields the spec sanctions.
        expect(keys.sort()).toEqual(
            ['anonymizedCount', 'createdAt', 'decisions', 'deletedCount', 'id', 'retainedCount', 'status', 'subjectEmail'].sort(),
        );
        // Defense-in-depth: nothing token-shaped leaks.
        const serialized = JSON.stringify(row).toLowerCase();
        expect(serialized).not.toContain('token');
        expect(serialized).not.toContain('requested_by');
        expect(serialized).not.toContain('requestedby');
    });

    it('returns an empty array when the tenant has no erasure log rows', async () => {
        const app = buildApp(db);
        const res = await request(app, '/api/admin/compliance/erasure-log');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: unknown[] };
        expect(body.data).toEqual([]);
    });
});
