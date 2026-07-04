/**
 * TDD tests for POST /:id/submit, POST /:id/return, POST /:id/unpublish
 * HTTP endpoints on the inspections router.
 *
 * Capability rules (from capabilities.ts):
 *   - submit: any role with access to the inspection (owner/manager/inspector)
 *   - return: requires `publish` capability (owner + manager by default;
 *     inspector only when not overridden to publish:false)
 *   - unpublish: requires `publish` capability (same)
 *
 * Agent has publish:false (pinned) — used to exercise the 403 path without
 * needing permission_overrides.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER mock is hoisted.
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
import { InspectionService } from '../../../server/services/inspection.service';

const TENANT   = '00000000-0000-0000-0000-000000000001';
const USER_ID  = '00000000-0000-0000-0000-000000000099';
const INSP_ID  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

// ── app factory ──────────────────────────────────────────────────────────────

/**
 * Builds a minimal Hono app mounting inspectionsRoutes with a real
 * InspectionService backed by the in-memory SQLite DB. Capability checks read
 * permission_overrides from the DB; for these tests we control capabilities
 * purely through `role` (owner/manager have publish=true, agent has
 * publish=false/pinned, inspector defaults to publish=true).
 */
function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    role: UserRole,
) {
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const svc = new InspectionService({} as D1Database);

    const app = new OpenAPIHono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: USER_ID, role, tenantId: TENANT });
        // sdb is used by requireCapability to resolve permission_overrides.
        // Provide a minimal stub that returns null overrides (pure role defaults).
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: null }),
        } as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: svc,
            // Stubs for other services the router may touch:
            reportVersion: { snapshotOnPublish: vi.fn().mockResolvedValue({ versionNumber: 1 }) },
            reportPdf: { isPipelineEnabled: vi.fn().mockResolvedValue(false) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

// ── seed helpers ─────────────────────────────────────────────────────────────

async function seedInspection(
    db: BetterSQLite3Database<typeof schema>,
    overrides: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.inspections).values({
        id:               INSP_ID,
        tenantId:         TENANT,
        propertyAddress:  '1 Main St',
        clientName:       'Test Client',
        clientEmail:      'client@example.com',
        date:             '2026-06-01',
        status:           INSPECTION_STATUS.COMPLETED,
        reportStatus:     REPORT_STATUS.IN_PROGRESS,
        paymentStatus:    'unpaid',
        price:            0,
        paymentRequired:  false,
        agreementRequired: false,
        createdAt:        new Date(),
        ...overrides,
    });
}

async function readReportStatus(db: BetterSQLite3Database<typeof schema>) {
    const row = await db.select({ reportStatus: schema.inspections.reportStatus })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, INSP_ID))
        .get();
    return row?.reportStatus;
}

// ── test suite ───────────────────────────────────────────────────────────────

describe('POST /api/inspections/:id/submit — report review endpoints', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'user@example.com',
            passwordHash: 'hash', createdAt: new Date(),
        });
    });

    // ── submit ───────────────────────────────────────────────────────────────

    it('inspector POST /submit on in_progress report → 200, reportStatus=submitted', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.IN_PROGRESS });
        const app = buildApp(db, 'inspector');
        const res = await app.request(
            `/api/inspections/${INSP_ID}/submit`,
            { method: 'POST' },
            FAKE_ENV,
        );
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        expect(await readReportStatus(db)).toBe(REPORT_STATUS.SUBMITTED);
    });

    it('owner POST /submit on in_progress report → 200', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.IN_PROGRESS });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/submit`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('agent POST /submit → 403 (agent not in the role gate for inspections)', async () => {
        await seedInspection(db);
        const app = buildApp(db, 'agent');
        const res = await app.request(`/api/inspections/${INSP_ID}/submit`, { method: 'POST' }, FAKE_ENV);
        // agent is excluded from owner/manager/inspector role gate → 403
        expect(res.status).toBe(403);
    });
});

describe('POST /api/inspections/:id/return — publish-gated', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'user@example.com',
            passwordHash: 'hash', createdAt: new Date(),
        });
    });

    it('manager POST /return on submitted report → 200, reportStatus=in_progress', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED });
        const app = buildApp(db, 'manager');
        const res = await app.request(`/api/inspections/${INSP_ID}/return`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        expect(await readReportStatus(db)).toBe(REPORT_STATUS.IN_PROGRESS);
    });

    it('owner POST /return on submitted report → 200', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/return`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector (publish:false override via sdb) POST /return → 403', async () => {
        // Simulate an inspector whose publish capability is revoked via
        // permission_overrides. We override the sdb stub to return {publish:false}.
        await seedInspection(db, { reportStatus: REPORT_STATUS.SUBMITTED });
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const svc = new InspectionService({} as D1Database);

        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'inspector');
            c.set('user', { sub: USER_ID, role: 'inspector', tenantId: TENANT });
            // Return publish:false override — simulates "requires review" inspector
            c.set('sdb', {
                getById: async () => ({ permissionOverrides: { publish: false } }),
            } as HonoConfig['Variables']['sdb']);
            c.set('services', {
                inspection: svc,
                reportVersion: { snapshotOnPublish: vi.fn().mockResolvedValue({ versionNumber: 1 }) },
                reportPdf: { isPipelineEnabled: vi.fn().mockResolvedValue(false) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);

        const res = await app.request(`/api/inspections/${INSP_ID}/return`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(403);
    });

    it('inspector with default publish:true POST /return → 200', async () => {
        // Inspector's default has publish=true; should be allowed.
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED });
        const app = buildApp(db, 'inspector');
        const res = await app.request(`/api/inspections/${INSP_ID}/return`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
    });
});

describe('POST /api/inspections/:id/unpublish — publish-gated', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'user@example.com',
            passwordHash: 'hash', createdAt: new Date(),
        });
    });

    it('manager POST /unpublish on published report → 200, reportStatus=in_progress', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.PUBLISHED });
        const app = buildApp(db, 'manager');
        const res = await app.request(`/api/inspections/${INSP_ID}/unpublish`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        expect(await readReportStatus(db)).toBe(REPORT_STATUS.IN_PROGRESS);
    });

    it('owner POST /unpublish on published report → 200', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.PUBLISHED });
        const app = buildApp(db, 'owner');
        const res = await app.request(`/api/inspections/${INSP_ID}/unpublish`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector (publish:false override) POST /unpublish → 403', async () => {
        await seedInspection(db, { reportStatus: REPORT_STATUS.PUBLISHED });
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const svc = new InspectionService({} as D1Database);

        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'inspector');
            c.set('user', { sub: USER_ID, role: 'inspector', tenantId: TENANT });
            c.set('sdb', {
                getById: async () => ({ permissionOverrides: { publish: false } }),
            } as HonoConfig['Variables']['sdb']);
            c.set('services', {
                inspection: svc,
                reportVersion: { snapshotOnPublish: vi.fn().mockResolvedValue({ versionNumber: 1 }) },
                reportPdf: { isPipelineEnabled: vi.fn().mockResolvedValue(false) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);

        const res = await app.request(`/api/inspections/${INSP_ID}/unpublish`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(403);
    });

    it('inspector with default publish:true POST /unpublish → 200', async () => {
        await seedInspection(db, { status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.PUBLISHED });
        const app = buildApp(db, 'inspector');
        const res = await app.request(`/api/inspections/${INSP_ID}/unpublish`, { method: 'POST' }, FAKE_ENV);
        expect(res.status).toBe(200);
    });
});
