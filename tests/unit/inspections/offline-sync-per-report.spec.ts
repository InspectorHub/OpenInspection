import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { tenants, inspections, reports, inspectionResults } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

/**
 * Field sync is per REPORT.
 *
 * `uq_results_report` is unique on `report_id`: an order carries one results row
 * per deliverable, and the standard report and the sewer report each own their
 * own findings. "The inspection's results" therefore stopped naming a row —
 * a select on `inspection_id` alone returns whichever the scan reaches first.
 *
 * These two routes are what the FIELD uses (a signature captured on site, a
 * photo deleted from a phone), they are addressed by inspection, and the
 * offline client holds no report id — so they must resolve the order's primary
 * report themselves. Each case below is seeded with the ANCILLARY row inserted
 * first, so a route that still matches on inspection id picks the wrong
 * document and the test fails rather than passing by luck of row order.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock above.
// eslint-disable-next-line import/order
import syncRoutes from '../../../server/api/inspection-sync';

const TENANT_ID  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSP_ID    = 'insp-offline-1';
const PRIMARY_REPORT = 'rep-primary';
const SEWER_REPORT   = 'rep-sewer';
/** The schema requires a real-sized data URL (min 100 chars), not a token blob. */
const SIGNATURE = 'data:image/png;base64,' + 'A'.repeat(200);
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err: unknown, c: Context<HonoConfig>) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as 500);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userRole', 'inspector');
        c.set('user', { sub: 'u-1', role: 'inspector', tenantId: TENANT_ID });
        c.set('services', {} as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', syncRoutes);
    (mockDrizzle as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(db);
    return app;
}

const photoRow = (label: string) => ({ 'item-1': { photos: [{ key: `${label}-a.jpg` }, { key: `${label}-b.jpg` }] } });

describe('offline field sync writes to the primary report, not to whichever results row comes first', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(db);

        await db.insert(tenants).values({
            id: TENANT_ID, slug: 'acme-test',
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as never);
        await db.insert(inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main',
            status: 'in_progress', date: '2026-08-04', createdAt: new Date(),
        } as never);
        // Ancillary FIRST, so an inspection-keyed scan reaches the wrong one.
        await db.insert(reports).values([
            { id: SEWER_REPORT, tenantId: TENANT_ID, inspectionId: INSP_ID, kind: 'ancillary', title: 'Sewer scope', status: 'in_progress', createdAt: new Date(1) },
            { id: PRIMARY_REPORT, tenantId: TENANT_ID, inspectionId: INSP_ID, kind: 'primary', title: 'Home inspection', status: 'in_progress', createdAt: new Date(2) },
        ] as never);
    });

    afterEach(() => sqlite.close());

    const seedResults = async () => {
        await db.insert(inspectionResults).values([
            { id: 'res-sewer', tenantId: TENANT_ID, inspectionId: INSP_ID, reportId: SEWER_REPORT, data: photoRow('sewer'), lastSyncedAt: new Date(1) },
            { id: 'res-primary', tenantId: TENANT_ID, inspectionId: INSP_ID, reportId: PRIMARY_REPORT, data: photoRow('primary'), lastSyncedAt: new Date(2) },
        ] as never);
    };

    const readRow = async (id: string) =>
        db.select().from(inspectionResults).where(eq(inspectionResults.id, id)).get();

    it('records an inspector signature on the primary report only', async () => {
        await seedResults();
        const res = await buildApp(db).request(`/${INSP_ID}/inspector-signature`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signatureBase64: SIGNATURE, signedAt: 1_754_000_000_000 }),
        }, FAKE_ENV);
        expect(res.status).toBe(200);

        const primary = await readRow('res-primary');
        const sewer   = await readRow('res-sewer');
        expect((primary?.data as Record<string, unknown>)['_inspector_signature']).toBeTruthy();
        expect((sewer?.data as Record<string, unknown>)['_inspector_signature']).toBeUndefined();
    });

    it('deletes a photo from the primary report, leaving the sewer report whole', async () => {
        await seedResults();
        const res = await buildApp(db).request(`/${INSP_ID}/items/item-1/photos/0`, { method: 'DELETE' }, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { deletedKey: string } };
        expect(body.data.deletedKey).toBe('primary-a.jpg');

        const primary = (await readRow('res-primary'))?.data as Record<string, { photos: { key: string }[] }>;
        const sewer   = (await readRow('res-sewer'))?.data as Record<string, { photos: { key: string }[] }>;
        expect(primary['item-1'].photos.map((p) => p.key)).toEqual(['primary-b.jpg']);
        expect(sewer['item-1'].photos.map((p) => p.key)).toEqual(['sewer-a.jpg', 'sewer-b.jpg']);
    });

    it('binds a results row it has to create to the primary report', async () => {
        // No results rows yet — the first thing to reach the server is the
        // signature. The row it creates used to carry a NULL report_id, which
        // the unique index permits and every report-scoped read ignores.
        const res = await buildApp(db).request(`/${INSP_ID}/inspector-signature`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signatureBase64: SIGNATURE, signedAt: 1_754_000_000_000 }),
        }, FAKE_ENV);
        expect(res.status).toBe(200);

        const rows = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.tenantId, TENANT_ID), eq(inspectionResults.inspectionId, INSP_ID))).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].reportId).toBe(PRIMARY_REPORT);
    });

    it('refuses an order with no primary report rather than writing an unowned row', async () => {
        await db.delete(reports).where(eq(reports.kind, 'primary'));
        const res = await buildApp(db).request(`/${INSP_ID}/inspector-signature`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signatureBase64: SIGNATURE, signedAt: 1_754_000_000_000 }),
        }, FAKE_ENV);
        expect(res.status).toBe(404);
        const rows = await db.select().from(inspectionResults).all();
        expect(rows).toHaveLength(0);
    });
});
