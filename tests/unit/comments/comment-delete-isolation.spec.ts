/**
 * Characterisation spec for OI #291 — deleting a library comment must not reach
 * delivered work.
 *
 * The library delete path is about to gain a UI, so 2,774 rows that have never
 * been deletable are about to become deletable. The whole design rests on one
 * claim: an inspection snapshots the comment TEXT, it does not reference the
 * library row. Nothing enforces that — `inspection_results` has no comment
 * column and no FK — so it is an invariant held only by convention, and this
 * spec is what makes breaking it fail here instead of in a delivered report.
 *
 * These tests are expected to pass on first run. That is the point: they pin
 * behaviour that already holds, so a future change to how defects reference the
 * library breaks a spec rather than a signature.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440091';
const COMMENT_ID = 'c-flue-tile';
const NARRATIVE = 'Cracked flue tile observed at the chimney crown.';

let db: BetterSQLite3Database<typeof schema>;

/** Mirrors `server/index.ts`'s onError so AppError surfaces as its own status. */
function buildApp(tenantId = TENANT, userId = 'u1') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', tenantId);
        c.set('user', { sub: userId } as never);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    return app;
}

async function deleteComment(id: string): Promise<number> {
    const res = await buildApp().request(
        `/api/admin/comments/${id}`,
        { method: 'DELETE' },
        { DB: {} },
    );
    return res.status;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The defect as the inspector left it — narrative copied out of the library. */
const resultsData = {
    sections: [{
        id: 'chimney',
        items: [{ id: 'flue', rating: 'significant', comment: NARRATIVE }],
    }],
};

async function seed() {
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'T', slug: 't', createdAt: new Date(),
    });
    await db.insert(schema.comments).values({
        id: COMMENT_ID, tenantId: TENANT, text: NARRATIVE,
        severity: 'significant', section: 'Chimney', category: null, createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
        date: '2026-01-15', status: 'completed', paymentStatus: 'unpaid',
        price: 50000, createdAt: new Date(),
    });
    await db.insert(schema.inspectionResults).values({
        id: 'r1', tenantId: TENANT, inspectionId: INSP_ID,
        data: resultsData, lastSyncedAt: new Date(),
    });
    const snapshotJson = JSON.stringify({ inspection: { id: INSP_ID }, results: resultsData });
    await db.insert(schema.reportVersions).values({
        id: 'v1', tenantId: TENANT, inspectionId: INSP_ID, versionNumber: 1,
        snapshotJson,
        contentHash: sha256(snapshotJson),
        signature: 'sig-over-content-hash',
        publishedAt: new Date(), publishedBy: 'u1', createdAt: new Date(),
    });
}

describe('DELETE /api/admin/comments/:id — isolation from delivered work (#291)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await seed();
    });

    it('leaves the defect narrative intact after its source comment is deleted', async () => {
        expect(await deleteComment(COMMENT_ID)).toBe(200);

        const gone = await db.select().from(schema.comments)
            .where(eq(schema.comments.id, COMMENT_ID)).get();
        expect(gone).toBeUndefined();

        const results = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, INSP_ID)).get();
        expect(results?.data).toEqual(resultsData);
    });

    it('leaves a published version verifiable — snapshot and hash both unchanged', async () => {
        // report_versions holds a snapshot with a content hash and a signature
        // over it. If a delete could reach the snapshot, every prior version
        // would fail verification and nothing would say so.
        const before = await db.select().from(schema.reportVersions)
            .where(eq(schema.reportVersions.id, 'v1')).get();

        expect(await deleteComment(COMMENT_ID)).toBe(200);

        const after = await db.select().from(schema.reportVersions)
            .where(eq(schema.reportVersions.id, 'v1')).get();
        expect(after).toEqual(before);
        // And the hash still describes the snapshot it is stored beside.
        expect(after?.contentHash).toBe(sha256(after!.snapshotJson));
    });

    it('refuses to delete a comment belonging to another tenant', async () => {
        const other = buildApp('00000000-0000-0000-0000-0000000000ff', 'u2');
        const res = await other.request(
            `/api/admin/comments/${COMMENT_ID}`, { method: 'DELETE' }, { DB: {} },
        );
        expect(res.status).toBe(404);
        const still = await db.select().from(schema.comments)
            .where(eq(schema.comments.id, COMMENT_ID)).get();
        expect(still?.text).toBe(NARRATIVE);
    });
});
