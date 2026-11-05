/**
 * Publishing again with nothing changed returns the existing version instead of making a new one.
 *
 * Real route, real ReportVersionService, real database. `publishInspection` stands in for everything
 * a publish does to the world (status flip, automations, auto-signature): a duplicate must not reach
 * it, and neither may the audit row or the translation. Every "no new version" case is paired with a
 * case on the same harness that does make one, so a harness that never publishes cannot read as clean.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ReportVersionService } from '../../../server/services/report-version.service';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const auditSpy = vi.fn();
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: (...args: unknown[]) => auditSpy(...args),
}));
const translateSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../server/lib/translation/on-publish', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    translateOnPublishForRequest: (...args: unknown[]) => translateSpy(...args),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000300';
const A = 'insp-a';
const B = 'insp-b';
const EXEC = makeExecutionContext().ctx;

let db: BetterSQLite3Database<typeof schema>;
const publishInspection = vi.fn();

function buildApp() {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', T);
        c.set('user', { sub: USER } as never);
        c.set('services', {
            inspection: { publishInspection },
            reportVersion: new ReportVersionService({} as D1Database, 'test-encryption-secret-key', []),
            reportPdf: { purgeTransientPdfs: vi.fn().mockResolvedValue(undefined), isPipelineEnabled: vi.fn().mockResolvedValue(false) },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function publish(id: string, body: Record<string, unknown> = {}) {
    const res = await buildApp().request(`/api/inspections/${id}/publish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, { DB: {}, JWT_SECRET: 'test-secret' }, EXEC);
    return { status: res.status, body: await res.json() as { success: boolean; data: Record<string, unknown> } };
}
const versions = (id: string) => db.select().from(schema.reportVersions).where(eq(schema.reportVersions.inspectionId, id)).all();
const setResults = (id: string, data: Record<string, unknown>) => db.update(schema.inspectionResults).set({ data: data as never }).where(eq(schema.inspectionResults.inspectionId, id));
const setReportStatus = (id: string, reportStatus: 'in_progress' | 'published') => db.update(schema.inspections).set({ reportStatus }).where(eq(schema.inspections.id, id));
const publishAudits = () => auditSpy.mock.calls.filter((a) => a[1] === 'inspection.published');

async function seed(id: string) {
    await db.insert(schema.inspections).values({
        id, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', status: 'scheduled', reportStatus: 'in_progress',
        paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
    });
    await db.insert(schema.inspectionResults).values({ id: `res-${id}`, tenantId: T, inspectionId: id, data: { i1: { rating: 'good' } } as never, lastSyncedAt: new Date() });
}

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    auditSpy.mockClear();
    translateSpy.mockClear();
    publishInspection.mockReset().mockImplementation(async (id: string) => {
        await setReportStatus(id, 'published');
        return { reportUrl: `/report/acme/${id}`, reportStatus: 'published' };
    });
    await db.insert(schema.tenants).values({ id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await db.insert(schema.users).values({ id: USER, tenantId: T, email: 'o@example.com', passwordHash: 'h', createdAt: new Date() });
    await seed(A);
});

describe('publish with nothing changed since the latest version', () => {
    it('answers 200 in the normal shape, makes no second version and does no publish work', async () => {
        const first = await publish(A);
        expect(first.status).toBe(200);
        const second = await publish(A);
        expect(second.status).toBe(200);
        // The normal shape, plus the one key that says nothing was published: the version that is still current.
        expect(Object.keys(second.body.data).sort()).toEqual([...Object.keys(first.body.data), 'unchangedSinceVersion'].sort());
        expect(first.body.data).not.toHaveProperty('unchangedSinceVersion');
        expect(second.body.data.unchangedSinceVersion).toBe(1);
        expect(second.body.data).toMatchObject({ reportUrl: first.body.data.reportUrl, reportStatus: 'published' });
        expect(await versions(A)).toHaveLength(1);
        expect(publishInspection).toHaveBeenCalledTimes(1);
        expect(publishAudits()).toHaveLength(1);
    });

    it('control: changing the results creates a new version and runs the publish again', async () => {
        await publish(A);
        await setResults(A, { i1: { rating: 'poor' } });
        expect((await publish(A)).status).toBe(200);
        expect((await versions(A)).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
        expect(publishInspection).toHaveBeenCalledTimes(2);
        expect(publishAudits()).toHaveLength(2);
    });

    it('a different summary is a change of options and creates a new version; the same summary is not', async () => {
        await publish(A, { summary: 'first' });
        await publish(A, { summary: 'first' });
        expect(await versions(A)).toHaveLength(1);
        await publish(A, { summary: 'second' });
        expect(await versions(A)).toHaveLength(2);
    });

    it('asking for a translation is never a duplicate', async () => {
        await publish(A);
        await publish(A, { translateTo: 'es-419' });
        expect(await versions(A)).toHaveLength(2);
        expect(translateSpy).toHaveBeenCalled();
    });

    it('a latest version whose frozen content differs (or predates the current snapshot shape) is not matched', async () => {
        await publish(A);
        await db.update(schema.reportVersions).set({ snapshotJson: '{"schemaVersion":1}', contentHash: null }).where(eq(schema.reportVersions.inspectionId, A));
        await publish(A);
        expect(await versions(A)).toHaveLength(2);
    });

    it('unpublishing in between makes the next publish a real one', async () => {
        await publish(A);
        await setReportStatus(A, 'in_progress');
        await publish(A);
        expect(publishInspection).toHaveBeenCalledTimes(2);
        expect(await versions(A)).toHaveLength(2);
    });

    it('another inspection with identical content is not matched against this one', async () => {
        await publish(A);
        await seed(B);
        await publish(B);
        expect(await versions(B)).toHaveLength(1);
        expect(publishInspection).toHaveBeenCalledTimes(2);
        // And B repeated is a duplicate of B, not of A.
        await publish(B);
        expect(await versions(B)).toHaveLength(1);
        expect(await versions(A)).toHaveLength(1);
        expect(publishInspection).toHaveBeenCalledTimes(2);
    });
});

describe('republishing a report that was being edited again', () => {
    const reportOf = async (id: string) => (await db.select().from(schema.reports).where(eq(schema.reports.inspectionId, id)).get())!;

    beforeEach(async () => {
        await db.insert(schema.reports).values({
            id: 'rep-a', tenantId: T, inspectionId: A, kind: 'primary', title: 'Report', status: 'in_progress', createdAt: new Date(),
        });
    });

    it('with nothing changed makes no new version but puts the lock back', async () => {
        await publish(A);
        // "Edit and republish" opened the report; the inspector changed nothing and publishes again.
        await db.update(schema.reports).set({ status: 'in_progress', publishedAt: new Date() }).where(eq(schema.reports.id, 'rep-a'));
        const again = await publish(A);
        expect(again.status).toBe(200);
        expect(await versions(A)).toHaveLength(1);
        expect(publishInspection).toHaveBeenCalledTimes(1);
        expect((await reportOf(A)).status).toBe('published');
    });

    it('(control) with a change it is a real publish and makes the next version', async () => {
        await publish(A);
        await db.update(schema.reports).set({ status: 'in_progress', publishedAt: new Date() }).where(eq(schema.reports.id, 'rep-a'));
        await setResults(A, { i1: { rating: 'defect' } });
        await publish(A);
        expect(await versions(A)).toHaveLength(2);
        expect(publishInspection).toHaveBeenCalledTimes(2);
    });
});

describe('a snapshot that differs only in object key order is unchanged', () => {
    it('answers as unchanged when the stored copy was projected with its keys in another order', async () => {
        await publish(A);
        const [row] = await versions(A);
        const stored = JSON.parse(row.snapshotJson) as Record<string, unknown>;
        // The same report with the top-level keys reversed and the findings keys reversed: equal content, different string.
        const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
        const reordered = JSON.stringify(reorder({ ...stored, data: reorder(stored.data as Record<string, unknown>) }));
        expect(reordered).not.toBe(row.snapshotJson);
        await db.update(schema.reportVersions).set({ snapshotJson: reordered }).where(eq(schema.reportVersions.id, row.id));

        const second = await publish(A);
        expect(second.body.data.unchangedSinceVersion).toBe(1);
        expect(await versions(A)).toHaveLength(1);
    });
});

describe('the step from snapshot version 3 to 4 is not by itself a change', () => {
    /** Rewrites the stored latest version as an older (version 3) snapshot: no `presentation`, schemaVersion 3. */
    async function downgradeStoredToV3(id: string) {
        const [row] = await versions(id);
        const old = JSON.parse(row.snapshotJson) as Record<string, unknown>;
        delete old.presentation;
        old.schemaVersion = 3;
        await db.update(schema.reportVersions).set({ snapshotJson: JSON.stringify(old) }).where(eq(schema.reportVersions.id, row.id));
    }

    it('a stored version 3 with identical content answers as unchanged (no spurious version)', async () => {
        await publish(A);
        await downgradeStoredToV3(A);
        const second = await publish(A);
        expect(second.body.data.unchangedSinceVersion).toBe(1);
        expect(await versions(A)).toHaveLength(1);
        expect(publishInspection).toHaveBeenCalledTimes(1);
    });

    it('(control) a stored version 3 with a content edit is still a real publish', async () => {
        await publish(A);
        await downgradeStoredToV3(A);
        await db.update(schema.reports).set({ status: 'in_progress', publishedAt: new Date() }).where(eq(schema.reports.id, 'rep-a'));
        await setResults(A, { i1: { rating: 'defect' } });
        const second = await publish(A);
        expect(second.body.data).not.toHaveProperty('unchangedSinceVersion');
        expect(await versions(A)).toHaveLength(2);
    });

    it('(control) a stored version 4 followed by a settings change is a real publish', async () => {
        await db.insert(schema.defectCategories).values({ id: 'cat-s', tenantId: T, name: 'safety', color: '#ef4444', drivesSummary: true, sortOrder: 1, isSeed: true, createdAt: new Date() });
        await publish(A);
        expect(JSON.parse((await versions(A))[0].snapshotJson)).toHaveProperty('presentation');
        await db.update(schema.reports).set({ status: 'in_progress', publishedAt: new Date() }).where(eq(schema.reports.id, 'rep-a'));
        await db.update(schema.defectCategories).set({ color: '#00aa55' }).where(eq(schema.defectCategories.id, 'cat-s'));
        const second = await publish(A);
        expect(second.body.data).not.toHaveProperty('unchangedSinceVersion');
        expect(await versions(A)).toHaveLength(2);
    });
});

describe('publish asks the live document to store its edits before it decides nothing changed', () => {
    const C = 'insp-c';
    const REPORT_C = 'rep-c';

    async function publishWithDocument(onFlush: () => Promise<void>) {
        const calls: string[] = [];
        const ns = {
            idFromName: (name: string) => name,
            get: () => ({ fetch: async (url: string) => {
                const action = new URL(url).pathname.slice(1);
                calls.push(action);
                if (action === 'flush') await onFlush();
                return new Response('{}');
            } }),
        };
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const res = await buildApp().request(`/api/inspections/${C}/publish`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        }, { DB: {}, JWT_SECRET: 'test-secret', INSPECTION_DOC: ns }, EXEC);
        return { calls, body: await res.json() as { data: Record<string, unknown> } };
    }

    beforeEach(async () => {
        await seed(C);
        await db.insert(schema.reports).values({ id: REPORT_C, tenantId: T, inspectionId: C, kind: 'primary', title: 'Home', status: 'in_progress', createdAt: new Date(1) });
    });

    it('a note typed in the last second is stored first, so the publish is a real one and the note reaches the client', async () => {
        const first = await publishWithDocument(async () => undefined);
        expect(first.body.data).not.toHaveProperty('unchangedSinceVersion');
        expect(await versions(C)).toHaveLength(1);

        // The inspector typed after the first publish; the document has not yet reached the database.
        const second = await publishWithDocument(async () => { await setResults(C, { i1: { rating: 'good', note: 'typed a moment ago' } }); });

        // Control: the flush was asked for, and the answer is not "nothing changed".
        expect(second.calls).toContain('flush');
        expect(second.body.data).not.toHaveProperty('unchangedSinceVersion');
        expect(await versions(C)).toHaveLength(2);
    });

    it('with nothing typed, the same flush changes nothing and the answer is still "nothing changed"', async () => {
        await publishWithDocument(async () => undefined);
        const again = await publishWithDocument(async () => undefined);
        expect(again.calls).toContain('flush');
        expect(again.body.data.unchangedSinceVersion).toBe(1);
        expect(await versions(C)).toHaveLength(1);
    });
});
