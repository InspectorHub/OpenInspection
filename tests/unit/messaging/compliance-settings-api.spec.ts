import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { erasureLog } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

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
import adminRoutes from '../../../server/api/admin';
import { LegalVersionService } from '../../../server/services/legal-version.service';
import { makeExecutionContext } from '../helpers/exec-ctx';

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
            // Real service over the test DB, not a stub. The PATCH handler
            // swallows a failure here on purpose (the version row is evidence
            // about a save, not part of it), so a stub that silently did
            // nothing would let a broken wiring pass as a green test — which is
            // exactly what happened the first time this spec was run.
            legalVersion: new LegalVersionService(db as never),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    (mockDrizzle as any).mockReturnValue(db);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'x' } as unknown as HonoConfig['Bindings'];

/** Minimal ExecutionContext stub — auditFromContext reads c.executionCtx. */
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const EXEC_CTX = makeExecutionContext().ctx;

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

    async function seedRow(over: Partial<Omit<typeof erasureLog.$inferInsert, 'createdAt'>> & { createdAt?: number } = {}) {
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
            createdAt: new Date(over.createdAt ?? Date.now()),
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

/**
 * Publishing a legal document records a version (design §6A.3).
 *
 * The read side is easy to build and easy to believe. The WRITE side is where
 * this feature is silently wrong or silently noisy, and both failure modes look
 * identical from the settings page:
 *
 *   - recording nothing, because the PATCH handler never called the historian —
 *     the version table stays empty and "Last updated" never appears;
 *   - recording a version on EVERY PATCH, so a tenant who changes their booking
 *     hours mints a new revision of their privacy policy.
 */
describe('PATCH /api/admin/tenant-config — legal document versions', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT_ID, defaultTimezone: 'UTC', updatedAt: new Date(),
        });
    });

    const patch = (app: OpenAPIHono<HonoConfig>, body: Record<string, unknown>) =>
        request(app, '/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    const versions = () => db.select().from(schema.tenantLegalVersions).all();

    it('records a version, WITH the body, when a legal document is saved', async () => {
        const app = buildApp(db);
        const res = await patch(app, { privacyBody: 'We collect only what an inspection needs.' });
        expect(res.status).toBe(200);

        const rows = await versions();
        expect(rows).toHaveLength(1);
        expect(rows[0].doc).toBe('privacy');
        // The body, not just a hash — the source column is mutable with nothing
        // behind it, so a row that cannot reproduce the text is worthless.
        expect(rows[0].bodySnapshot).toBe('We collect only what an inspection needs.');
        expect(rows[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('records NOTHING when the PATCH did not touch a legal document', async () => {
        const app = buildApp(db);
        const res = await patch(app, { agreementRetentionYears: 7 });
        expect(res.status).toBe(200);
        expect(await versions()).toHaveLength(0);
    });

    it('records nothing on a re-save of identical text', async () => {
        const app = buildApp(db);
        await patch(app, { privacyBody: 'Same words.' });
        await patch(app, { privacyBody: 'Same words.' });
        expect(await versions()).toHaveLength(1);
    });

    it('versions the two documents independently', async () => {
        const app = buildApp(db);
        await patch(app, { privacyBody: 'P text.', termsBody: 'T text.' });
        const rows = await versions();
        expect(rows.map((r) => r.doc).sort()).toEqual(['privacy', 'terms']);
    });

    it('does not fail the settings save when recording the version throws', async () => {
        // The version row is evidence ABOUT a save, not part of it. Failing the
        // tenant's actual change because the historian fell over would lose the
        // thing they asked for in order to protect the record of it.
        const app = buildApp(db);
        const boom = vi.spyOn(LegalVersionService.prototype, 'recordPublish')
            .mockRejectedValue(new Error('registry down'));
        const res = await patch(app, { privacyBody: 'Still saves.' });
        expect(res.status).toBe(200);
        boom.mockRestore();
    });
});
