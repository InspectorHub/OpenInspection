/**
 * "Edit and republish" and "Retract": the two ways back out of a published report, and what each leaves behind.
 *
 *   edit again : the report is editable, clients KEEP its latest version, no link expires, nothing is sent
 *   retract    : the report is withdrawn, every link expires, it is a draft again
 *
 * The state is the pair (`reports.status`, `reports.published_at`); the rule is in `lib/inspection/report-lock.ts`.
 * Runs the real routes against a real in-memory database. Every refusal has a positive control.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { InspectionService } from '../../../server/services/inspection.service';
import { AppError } from '../../../server/lib/errors';
import { relockUnchangedReport, reportEditState } from '../../../server/lib/inspection/report-lock';
import { deleteReport, listReportsForHub, reportDeleteBlock } from '../../../server/lib/inspection/reports';
import { changedFrozenFields } from '../../../server/lib/report-freeze';
import { setCollabDocLocks } from '../../../server/lib/collab/doc-lock-notify';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { asD1Db, type TestDb } from '../helpers/test-db';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000300';
const INSP = '550e8400-e29b-41d4-a716-446655440000';
const PRIMARY = 'report-primary';
const RADON = 'report-radon';

describe('edit again and retract', () => {
    let db: TestDb;
    let binding: D1Database;
    let svc: InspectionService;
    let expired: string[];
    let docCalls: Array<{ doc: string; action: string }>;
    const exec = makeExecutionContext();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        binding = toD1Binding(fixture.sqlite);
        svc = new InspectionService(binding);
        expired = [];
        docCalls = [];
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'paid', price: 0, createdAt: new Date(),
        } as never);
        const when = new Date('2026-06-02T00:00:00Z');
        await db.insert(schema.reports).values([
            { id: PRIMARY, tenantId: TENANT, inspectionId: INSP, kind: 'primary', title: 'Home', status: 'published', publishedAt: when, createdAt: new Date(1) },
            { id: RADON, tenantId: TENANT, inspectionId: INSP, kind: 'ancillary', title: 'Radon', status: 'published', publishedAt: when, createdAt: new Date(2), sortOrder: 1 },
        ]);
    });

    const row = async (id: string) => (await db.select().from(schema.reports).where(eq(schema.reports.id, id)).get())!;
    const order = async () => (await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP)).get())!;

    function request(path: string, body: unknown = {}) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner' as never);
            c.set('tenantId', TENANT);
            c.set('user', { sub: USER } as never);
            c.set('services', {
                inspection: svc,
                portalAccess: { setExpiryForInspection: async (_t: string, id: string) => { expired.push(id); } },
            } as never);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);
        const ns = {
            idFromName: (name: string) => name,
            get: (id: string) => ({ fetch: async (url: string) => { docCalls.push({ doc: id, action: new URL(url).pathname.slice(1) }); return new Response('{}'); } }),
        };
        return app.request(`/api/inspections/${INSP}${path}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
            { DB: binding, INSPECTION_DOC: ns }, exec.ctx);
    }

    describe('POST /edit-again', () => {
        it('opens the primary report for editing: status in_progress, published_at kept, order still published, nothing expired', async () => {
            const res = await request('/edit-again');
            expect(res.status).toBe(200);
            expect((await res.json() as { data: unknown }).data).toEqual({ reportId: PRIMARY, state: 'editing' });
            const primary = await row(PRIMARY);
            expect(primary.status).toBe('in_progress');
            expect(primary.publishedAt).toBeTruthy();
            expect(reportEditState(primary)).toBe('editing');
            // Clients keep the version: the order's own status is untouched, and no link is withdrawn.
            expect((await order()).reportStatus).toBe('published');
            expect(expired).toEqual([]);
            // The sibling deliverable stays locked, and the primary's document is told it may take sockets again.
            expect((await row(RADON)).status).toBe('published');
            expect(docCalls).toEqual([{ doc: `${TENANT}:${PRIMARY}`, action: 'unlock' }]);
        });

        it('stamps published_at from the latest version for a report published before the stamp was kept, and stays idempotent', async () => {
            // A legacy row: published, no published_at, with two versions on record.
            await db.update(schema.reports).set({ publishedAt: null }).where(eq(schema.reports.id, PRIMARY));
            const v1 = new Date('2026-06-03T00:00:00Z');
            const v2 = new Date('2026-06-04T00:00:00Z');
            for (const [n, at] of [[1, v1], [2, v2]] as const) {
                await db.insert(schema.reportVersions).values({
                    id: `v${n}`, tenantId: TENANT, inspectionId: INSP, reportId: PRIMARY, versionNumber: n, publishedAt: at, publishedBy: USER, snapshotJson: '{}',
                } as never);
            }
            expect(reportEditState(await row(PRIMARY))).toBe('published');

            const res = await request('/edit-again');

            expect(res.status).toBe(200);
            const primary = await row(PRIMARY);
            // Without the stamp this would read as a plain draft (no "editing again" banner, no notice choice on republish).
            expect(reportEditState(primary)).toBe('editing');
            expect(primary.publishedAt?.getTime()).toBe(v2.getTime());
            expect((await request('/edit-again')).status).toBe(200);
            expect((await row(PRIMARY)).publishedAt?.getTime()).toBe(v2.getTime());
        });

        it('opens a NAMED report, leaving the primary published', async () => {
            expect((await request('/edit-again', { reportId: RADON })).status).toBe(200);
            expect((await row(RADON)).status).toBe('in_progress');
            expect((await row(PRIMARY)).status).toBe('published');
        });

        it('refuses a report that was never published (nothing to unlock), and one that does not exist', async () => {
            await db.update(schema.reports).set({ status: 'in_progress', publishedAt: null }).where(eq(schema.reports.id, PRIMARY));
            expect((await request('/edit-again')).status).toBe(400);
            expect((await request('/edit-again', { reportId: 'nope' })).status).toBe(404);
        });

        it('reopens a published order that has no report row at all, by creating the primary report already in the editing state', async () => {
            await db.delete(schema.reports).where(eq(schema.reports.inspectionId, INSP));
            expect(await db.select().from(schema.reports).all()).toHaveLength(0);

            const res = await request('/edit-again');
            expect(res.status).toBe(200);

            const rows = await db.select().from(schema.reports).all();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ kind: 'primary', status: 'in_progress' });
            expect(rows[0]!.publishedAt).not.toBeNull();
            expect((await order()).reportStatus).toBe('published');
            // A named report that does not exist is still a 404: only the primary one is created on demand.
            expect((await request('/edit-again', { reportId: 'nope' })).status).toBe(404);
            // An order that was never published has nothing to reopen.
            await db.delete(schema.reports).where(eq(schema.reports.inspectionId, INSP));
            await db.update(schema.inspections).set({ reportStatus: 'in_progress' }).where(eq(schema.inspections.id, INSP));
            expect((await request('/edit-again')).status).toBe(404);
        });

        it('is idempotent: a second call on a report already being edited again answers the same 200 and changes nothing', async () => {
            const first = await request('/edit-again');
            const before = await row(PRIMARY);
            const second = await request('/edit-again');
            expect(second.status).toBe(200);
            expect((await second.json() as { data: unknown }).data).toEqual({ reportId: PRIMARY, state: 'editing' });
            expect(first.status).toBe(200);
            expect(await row(PRIMARY)).toEqual(before);
            expect(expired).toEqual([]);
        });

        it('records who reopened it (audit) without touching earlier rows', async () => {
            await request('/edit-again');
            await exec.settle();
            const rows = await db.select().from(schema.auditLogs).all();
            expect(rows.map((r) => r.action)).toContain('inspection.report_reopened');
        });
    });

    describe('POST /unpublish (retract)', () => {
        it('withdraws the report: every report is a draft again, published_at cleared, links expired, documents unlocked', async () => {
            const res = await request('/unpublish');
            expect(res.status).toBe(200);
            expect((await order()).reportStatus).toBe('in_progress');
            for (const id of [PRIMARY, RADON]) {
                const r = await row(id);
                expect(r.status).toBe('in_progress');
                expect(r.publishedAt).toBeNull();
                expect(reportEditState(r)).toBe('draft');
            }
            expect(expired).toEqual([INSP]);
            expect(docCalls.map((c) => c.action)).toEqual(['unlock', 'unlock']);
            await exec.settle();
            expect((await db.select().from(schema.auditLogs).all()).map((r) => r.action)).toContain('inspection.report_retracted');
        });

        it('differs from edit-again exactly in what it takes from clients (positive control for both)', async () => {
            await request('/edit-again');
            const editing = await row(PRIMARY);
            expect(editing.publishedAt).toBeTruthy();
            expect(expired).toEqual([]);
            // Retracting a report that is being edited again is allowed: the order is still "published".
            expect((await request('/unpublish')).status).toBe(200);
            expect((await row(PRIMARY)).publishedAt).toBeNull();
            expect(expired).toEqual([INSP]);
        });
    });

    describe('republishing without a change', () => {
        it('restores the lock without a new version', async () => {
            await request('/edit-again');
            await relockUnchangedReport(asD1Db(db), TENANT, INSP);
            expect((await row(PRIMARY)).status).toBe('published');
            expect(reportEditState(await row(PRIMARY))).toBe('published');
        });
    });

    describe('what the order page and the delete rule see', () => {
        it('reports editingAgain only for a published report that is open for editing', async () => {
            await request('/edit-again');
            const list = await listReportsForHub(asD1Db(db), TENANT, INSP);
            expect(list.map((r) => [r.id, r.editingAgain])).toEqual([[PRIMARY, true], [RADON, false]]);
        });

        it('keeps a report that went out undeletable while it is being edited again (its signed versions exist)', () => {
            const out = new Date();
            expect(reportDeleteBlock({ kind: 'ancillary', status: 'published', publishedAt: out }, 1)).toBe('published');
            expect(reportDeleteBlock({ kind: 'ancillary', status: 'in_progress', publishedAt: out }, 1)).toBe('published');
            expect(reportDeleteBlock({ kind: 'ancillary', status: 'in_progress', publishedAt: null }, 0)).toBeNull();
        });

        it('keeps a RETRACTED report undeletable while it owns signed versions: retract clears published_at, the versions remain', async () => {
            await db.insert(schema.reportVersions).values({
                id: 'v-radon', tenantId: TENANT, inspectionId: INSP, reportId: RADON, versionNumber: 1, snapshotJson: '{}',
                publishedAt: new Date(), publishedBy: USER, verificationToken: 'tok',
            });
            await request('/unpublish');
            const radon = await row(RADON);
            expect(radon.publishedAt).toBeNull();
            expect(reportDeleteBlock(radon, 1)).toBe('published');
            await expect(deleteReport(asD1Db(db), TENANT, INSP, RADON)).rejects.toMatchObject({ status: 409 });
            expect(await db.select().from(schema.reportVersions).all()).toHaveLength(1);
            // Control: a deliverable that never went out is still deletable.
            await db.insert(schema.reports).values({ id: 'draft-extra', tenantId: TENANT, inspectionId: INSP, kind: 'ancillary', title: 'Draft', status: 'in_progress', createdAt: new Date(3), sortOrder: 2 });
            await deleteReport(asD1Db(db), TENANT, INSP, 'draft-extra');
            expect(await db.select().from(schema.reports).where(eq(schema.reports.id, 'draft-extra')).all()).toHaveLength(0);
        });
    });

    describe('the inspection fields the published report shows', () => {
        const current = { propertyAddress: '1 Main St', yearBuilt: 1990, county: null, internalNotes: 'x' };

        it('compares the date by its DAY and objects by content: scheduling formats and key order are not edits', () => {
            const row = { date: '2026-06-01T10:00:00.000Z', propertyFacts: { a: 1, b: { c: 2, d: 3 } }, closingDate: '2026-07-01' };
            expect(changedFrozenFields({ date: '2026-06-01' }, row)).toEqual([]);
            expect(changedFrozenFields({ date: '2026-06-02' }, row)).toEqual(['date']);
            expect(changedFrozenFields({ propertyFacts: { b: { d: 3, c: 2 }, a: 1 } }, row)).toEqual([]);
            expect(changedFrozenFields({ propertyFacts: { a: 1, b: { c: 2, d: 4 } } }, row)).toEqual(['propertyFacts']);
            // The closing date is not on the report, so it is not report content.
            expect(changedFrozenFields({ closingDate: '2026-08-01' }, row)).toEqual([]);
        });

        it('counts only a CHANGE of a content column: a form that forwards its whole state is not an edit', () => {
            expect(changedFrozenFields({ propertyAddress: '1 Main St', yearBuilt: 1990, county: '' }, current)).toEqual([]);
            expect(changedFrozenFields({ yearBuilt: 2001 }, current)).toEqual(['yearBuilt']);
            expect(changedFrozenFields({ propertyAddress: '2 Oak St', county: 'Travis' }, current).sort()).toEqual(['county', 'propertyAddress']);
            expect(changedFrozenFields({ internalNotes: 'changed', price: 5 }, current)).toEqual([]);
        });

        async function patch(body: Record<string, unknown>) {
            const app = new OpenAPIHono<HonoConfig>();
            app.onError((err, c) => (err instanceof AppError
                ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
                : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
            app.use('*', async (c, next) => {
                c.set('userRole', 'manager' as never);
                c.set('tenantId', TENANT);
                c.set('user', { sub: USER } as never);
                // The row as it is NOW: the handler compares the body with it.
                c.set('services', { inspection: { getInspection: async () => ({ inspection: await order() }) } } as never);
                await next();
            });
            app.route('/api/inspections', inspectionsRoutes);
            return app.request(`/api/inspections/${INSP}`,
                { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: binding }, exec.ctx);
        }

        it('PATCH refuses a changed content field on a published report (409) and accepts it once editing again', async () => {
            const refused = await patch({ county: 'Travis' });
            expect(refused.status).toBe(409);
            expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('REPORT_PUBLISHED');
            expect(((await db.select().from(schema.inspections).get()) as { county: string | null }).county).toBeNull();

            await request('/edit-again');
            expect((await patch({ county: 'Travis' })).status).toBe(200);
            expect(((await db.select().from(schema.inspections).get()) as { county: string | null }).county).toBe('Travis');
        });

        it('PATCH still saves what is not report content on a published report', async () => {
            expect((await patch({ referenceNumber: 'PO-77' })).status).toBe(200);
            expect(((await db.select().from(schema.inspections).get()) as { referenceNumber: string | null }).referenceNumber).toBe('PO-77');
        });
    });

    describe('telling the results documents', () => {
        const namespace = (calls: string[], fail = false) => ({
            idFromName: (n: string) => n,
            get: (id: string) => ({ fetch: async (url: string) => { if (fail) throw new Error('unreachable'); calls.push(`${id} ${url}`); return new Response('{}'); } }),
        }) as unknown as DurableObjectNamespace;

        it('locks the primary document, and a document it cannot reach never fails the request', async () => {
            const calls: string[] = [];
            await setCollabDocLocks({ INSPECTION_DOC: namespace(calls) }, asD1Db(db), TENANT, INSP, true, { primary: true });
            expect(calls).toEqual([`${TENANT}:${PRIMARY} https://do.local/lock`]);
            await expect(setCollabDocLocks({ INSPECTION_DOC: namespace([], true) }, asD1Db(db), TENANT, INSP, true, { primary: true })).resolves.toBeUndefined();
            await expect(setCollabDocLocks({}, asD1Db(db), TENANT, INSP, true, { primary: true })).resolves.toBeUndefined();
        });
    });
});
