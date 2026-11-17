/**
 * POST /api/inspections/:id/copy-report through the real router: who may call it, what it answers, and
 * the audit record it leaves (ids, scope and counts only, never text, file names or an address).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { CopyReportBodySchema } from '../../../server/lib/validations/copy-report.schema';
import { AppError } from '../../../server/lib/errors';
import { InspectionCopyReportService } from '../../../server/services/inspection/inspection-copy-report.service';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import { d1For } from '../helpers/d1-binding';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { makeMemoryR2, type MemoryR2 } from '../helpers/memory-r2';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 't-acme';
const SRC = 'src-insp';
const USER = 'user-1';
const ADDRESS = '1 Main St SECRET-ADDRESS';
const NOTE = 'SECRET-NOTE text';
const FILE = 'SECRET-FILENAME.jpg';
const TEMPLATE = { sections: [{ id: 's1', title: 'Roof', items: [{ id: 'i1', label: 'Shingles' }] }] };

describe('POST /api/inspections/:id/copy-report', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let binding: D1Database;
    let r2: MemoryR2;
    const exec = makeExecutionContext();

    const count = (table: string, where = '1=1') => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

    async function call(opts: { readFails?: boolean; id?: string; body?: unknown; role?: string; userId?: string; tenantId?: string; quota?: boolean } = {}) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('userRole', (opts.role ?? 'owner') as never);
            c.set('tenantId', opts.tenantId ?? TENANT);
            c.set('user', { sub: opts.userId ?? USER } as never);
            c.set('profile', { hasUsageQuota: opts.quota ?? false, billingPortalUrl: null } as never);
            c.set('services', { inspection: opts.readFails ? { getInspection: async () => { throw new Error('read failed'); } } : new InspectionService(binding, undefined, new ScopedDB(testDb as never, opts.tenantId ?? TENANT)) } as never);
            c.set('sdb', new ScopedDB(testDb as never, opts.tenantId ?? TENANT));
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);
        const res = await app.request(`/api/inspections/${opts.id ?? SRC}/copy-report`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) },
            { DB: binding, PHOTOS: r2.bucket }, exec.ctx);
        await exec.settle();
        return { status: res.status, json: (await res.json()) as { success: boolean; data?: { inspection: { id: string; status: string; paymentStatus: string }; summary: { findings: { copied: number; dropped: number }; photos: { requested: boolean; copied: number; complete: boolean | null } } }; error?: { code: string } } };
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        binding = d1For(testDb);
        r2 = makeMemoryR2();
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: 't-other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspections).values({
            id: SRC, tenantId: TENANT, propertyAddress: ADDRESS, date: '2026-06-01', status: 'completed', reportStatus: 'published', paymentStatus: 'paid', price: 0,
            templateSnapshot: TEMPLATE, createdAt: new Date(1),
        } as never);
        await testDb.insert(schema.reports).values({ id: 'r-src', tenantId: TENANT, inspectionId: SRC, kind: 'primary', title: 'Home', status: 'published', publishedAt: new Date(2), createdAt: new Date(1) });
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-src', tenantId: TENANT, inspectionId: SRC, reportId: 'r-src', lastSyncedAt: new Date(1),
            data: { '_default:s1:i1': { rating: 'defect', notes: NOTE, photos: [{ key: `${TENANT}/inspections/${SRC}/photos/${FILE}` }] } } as never,
        });
        r2.seed(`${TENANT}/inspections/${SRC}/photos/${FILE}`, 'bytes');
        // Two inspectors who see only the inspections they are on, and one who sees every inspection.
        await testDb.insert(schema.users).values([
            { id: 'insp-1', tenantId: TENANT, email: 'a@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date(), permissionOverrides: { viewAllInspections: false } },
            { id: 'someone-else', tenantId: TENANT, email: 'b@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date(), permissionOverrides: { viewAllInspections: false } },
            { id: 'insp-all', tenantId: TENANT, email: 'c@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
        ] as never);
    });

    it('creates the copy: 201, a draft unpaid inspection, the counts, and the defaults (no photos, rating and notes, same property)', async () => {
        const { status, json } = await call();
        expect(status).toBe(201);
        expect(json.data!.inspection).toMatchObject({ status: 'requested', paymentStatus: 'unpaid' });
        expect(json.data!.inspection.id).not.toBe(SRC);
        expect(json.data!.summary).toMatchObject({ findings: { copied: 1, dropped: 0 }, photos: { requested: false, copied: 0, complete: null }, people: { requested: true, copied: true }, roster: { copied: true } });
        const row = (await testDb.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, json.data!.inspection.id)).get())!;
        expect(row.data).toEqual({ '_default:s1:i1': { rating: 'defect', notes: NOTE } });
    });

    it('audit: one inspection.copy_report row of ids, scope and counts, and the ordinary create row; no text, file name or address in either', async () => {
        const { json } = await call({ body: { scope: 'all', photos: true } });
        const id = json.data!.inspection.id;
        const rows = await testDb.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, id)).all();
        const copyRow = rows.find((r) => r.action === 'inspection.copy_report')!;
        expect(copyRow).toBeTruthy();
        expect(copyRow).toMatchObject({ tenantId: TENANT, userId: USER, entityType: 'inspection' });
        expect(copyRow.metadata).toEqual({
            sourceId: SRC, scope: 'all', samePropertyCopied: true, photosRequested: true,
            findingsCopied: 1, findingsDropped: 0, photosCopied: 1, photosFailed: 0,
        });
        const created = rows.find((r) => r.action === 'inspection.create')!;
        expect(created.metadata).toEqual({ clonedFrom: SRC });
        const everything = JSON.stringify(rows);
        for (const secret of [ADDRESS, 'SECRET-ADDRESS', NOTE, 'SECRET-NOTE', FILE, 'SECRET-FILENAME', 'Main St']) expect(everything).not.toContain(secret);
    });

    it('a different property without a scope copies ratings only, notes stay behind', async () => {
        const { status, json } = await call({ body: { property: 'different', propertyAddress: '9 Elm Ave' } });
        expect(status).toBe(201);
        const row = (await testDb.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, json.data!.inspection.id)).get())!;
        expect(row.data).toEqual({ '_default:s1:i1': { rating: 'defect' } });
    });

    it('when the new inspection cannot be read back the answer is still 201 with its basic header, and the audit rows are written', async () => {
        const { status, json } = await call({ readFails: true });
        expect(status).toBe(201);
        expect(json.data!.inspection).toMatchObject({ status: 'requested', clientName: null });
        expect(count('audit_logs', `action = 'inspection.copy_report' AND entity_id = '${json.data!.inspection.id}'`)).toBe(1);
        expect(count('inspections')).toBe(2);
    });

    it('validation: a different property needs an address (400, nothing written), and an unknown scope is refused', async () => {
        const before = count('inspections');
        expect((await call({ body: { property: 'different' } })).status).toBe(400);
        expect((await call({ body: { scope: 'everything-please' } })).status).toBe(400);
        expect((await call({ body: { property: 'different', propertyAddress: '9 Elm Ave', photos: true } })).status).toBe(400);
        expect(count('inspections')).toBe(before);
        expect((await call({ body: { property: 'different', propertyAddress: '9 Elm Ave' } })).status).toBe(201);
    });

    it('the request schema itself refuses photos for a different property, and applies the defaults', () => {
        expect(CopyReportBodySchema.safeParse({ property: 'different', propertyAddress: '9 Elm Ave', photos: true }).success).toBe(false);
        expect(CopyReportBodySchema.safeParse({ property: 'different', propertyAddress: '9 Elm Ave' }).success).toBe(true);
        expect(CopyReportBodySchema.parse({})).toEqual({ scope: 'rating_notes', property: 'same', photos: false });
        // A different property takes ratings only unless the caller names a scope.
        expect(CopyReportBodySchema.parse({ property: 'different', propertyAddress: '9 Elm Ave' }).scope).toBe('rating');
        expect(CopyReportBodySchema.parse({ property: 'different', propertyAddress: '9 Elm Ave', scope: 'all' }).scope).toBe('all');
        expect(CopyReportBodySchema.parse({ scope: 'rating' }).scope).toBe('rating');
    });

    it('roles: owner, manager and inspectors may copy; office staff and agents may not', async () => {
        await testDb.insert(schema.inspectionInspectors).values({ inspectionId: SRC, userId: 'insp-1', tenantId: TENANT, role: 'lead', createdAt: new Date(1) });
        expect((await call({ role: 'manager' })).status).toBe(201);
        expect((await call({ role: 'inspector', userId: 'insp-1' })).status).toBe(201);
        expect((await call({ role: 'inspector', userId: 'insp-all' })).status).toBe(201);
        const before = count('inspections');
        expect((await call({ role: 'staff' })).status).toBe(403);
        expect((await call({ role: 'agent' })).status).toBe(403);
        expect(count('inspections')).toBe(before);
    });

    it('an inspector restricted to their own inspections cannot copy one they are not on: 404, as if it did not exist, and nothing is written', async () => {
        await testDb.insert(schema.inspectionInspectors).values({ inspectionId: SRC, userId: 'insp-1', tenantId: TENANT, role: 'lead', createdAt: new Date(1) });
        const before = { inspections: count('inspections'), objects: r2.keys().length };
        const outsider = await call({ role: 'inspector', userId: 'someone-else' });
        expect(outsider.status).toBe(404);
        expect(count('inspections')).toBe(before.inspections);
        expect(r2.keys()).toHaveLength(before.objects);
        expect(count('audit_logs', `action = 'inspection.copy_report'`)).toBe(0);
        // Positive control: the inspector who IS on it gets through.
        expect((await call({ role: 'inspector', userId: 'insp-1' })).status).toBe(201);
    });

    it('another company\'s inspection id answers 404 from either side', async () => {
        await testDb.insert(schema.inspections).values({ id: 'foreign', tenantId: 't-other', propertyAddress: '2 Oak', date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(1) } as never);
        expect((await call({ id: 'foreign' })).status).toBe(404);
        expect((await call({ id: SRC, tenantId: 't-other' })).status).toBe(404);
        expect(count('inspections', `tenant_id = 't-other'`)).toBe(1);
    });

    it('a spent allowance answers 402 and writes nothing at all, no audit row and no object', async () => {
        const service = new InspectionCopyReportService(binding, r2.bucket, new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null }));
        for (let i = 0; i < 5; i++) await service.copyReport(TENANT, SRC, { scope: 'rating', property: 'same', photos: false });
        const before = { inspections: count('inspections'), results: count('inspection_results'), objects: r2.keys().length };
        const { status, json } = await call({ quota: true, body: { photos: true } });
        expect(status).toBe(402);
        expect(json.error?.code).toBe('QUOTA_EXHAUSTED');
        expect({ inspections: count('inspections'), results: count('inspection_results'), objects: r2.keys().length }).toEqual(before);
        expect(count('audit_logs', `action = 'inspection.copy_report'`)).toBe(0);
    });
});
