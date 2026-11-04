/**
 * C12: the agreement retention sweep works through a large backlog in bounded chunks, a bounded number per run. One statement or one
 * bucket call over every due envelope fails outright once the backlog is big (D1 allows 100 bound values per statement, a bucket delete
 * 1000 keys), and a sweep that throws at the first oversized batch would then never purge anything again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { logger } from '../../../server/lib/logger';
import { eq, isNull, isNotNull } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { runRetentionSweep } from '../../../server/lib/compliance/retention-sweep';

const NOW = Date.UTC(2026, 5, 8);
const LONG_AGO = new Date(Date.UTC(2015, 0, 1));
const BACKLOG = 450;

describe('runRetentionSweep over a large backlog', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };
    let rawSqlite: ReturnType<typeof createTestDb>['sqlite'];
    const deleteCalls: number[] = [];
    const bucket = { delete: async (keys: string[]) => { deleteCalls.push(Array.isArray(keys) ? keys.length : 1); } } as unknown as R2Bucket;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        rawSqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        deleteCalls.length = 0;
        await db.insert(schema.tenants).values({ id: 't1', slug: 't1', createdAt: new Date(NOW) });
        await db.insert(schema.tenantConfigs).values({ tenantId: 't1', agreementRetentionYears: 6, updatedAt: new Date(NOW) } as never);
        await db.insert(schema.inspections).values({
            id: 'insp-1', tenantId: 't1', propertyAddress: '1 Main', date: '2015-01-01', status: 'completed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(NOW),
        } as never);
        await db.insert(schema.agreements).values({ id: 'agr', tenantId: 't1', name: 'Tpl', content: 'b', createdAt: new Date(NOW) } as never);
        for (let start = 0; start < BACKLOG; start += 50) {
            const ids = Array.from({ length: Math.min(50, BACKLOG - start) }, (_v, i) => `req-${String(start + i).padStart(4, '0')}`);
            await db.insert(schema.agreementRequests).values(ids.map((id) => ({
                id, tenantId: 't1', inspectionId: 'insp-1', agreementId: 'agr', status: 'signed' as const, signedAt: LONG_AGO,
                clientEmail: 'jane@example.com', clientName: 'Jane', createdAt: LONG_AGO,
            })) as never);
            await db.insert(schema.agreementSigners).values(ids.map((id) => ({
                id: `signer-${id}`, tenantId: 't1', requestId: id, name: 'Jane', email: 'jane@example.com', role: 'client' as const,
                status: 'signed' as const, signatureBase64: 'data:image/png;base64,aGVsbG8=', signedAt: LONG_AGO, createdAt: LONG_AGO,
            })) as never);
        }
    });
    afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });

    const purged = async () => (await db.select({ id: schema.agreementRequests.id }).from(schema.agreementRequests).where(isNotNull(schema.agreementRequests.purgedAt)).all()).length;

    it('purges a bounded number per run, in small bucket calls, and finishes the rest on the next runs', async () => {
        const first = await runRetentionSweep(db as never, NOW, { photos: bucket });
        expect(first.purgedEnvelopes).toBe(400);
        expect(first.purgedSigners).toBe(400);
        expect(first.purgedArtefacts).toBe(1200);
        expect(await purged()).toBe(400);
        // No bucket call carries more than a chunk of keys (3 per envelope), far under the 1000-key limit.
        expect(Math.max(...deleteCalls)).toBeLessThanOrEqual(120);

        const second = await runRetentionSweep(db as never, NOW, { photos: bucket });
        expect(second.purgedEnvelopes).toBe(50);
        expect(await purged()).toBe(BACKLOG);

        const third = await runRetentionSweep(db as never, NOW, { photos: bucket });
        expect(third).toEqual({ purgedEnvelopes: 0, purgedSigners: 0, purgedArtefacts: 0, failedChunks: 0 });
        // Every signature is gone and every envelope is marked.
        const withSignature = await db.select({ id: schema.agreementSigners.id }).from(schema.agreementSigners).where(isNotNull(schema.agreementSigners.signatureBase64)).all();
        expect(withSignature).toHaveLength(0);
        expect(await db.select().from(schema.agreementRequests).where(isNull(schema.agreementRequests.purgedAt)).all()).toHaveLength(0);
        void eq;
    });

    it('works through the oldest signatures first when the cap leaves some for the next run', async () => {
        // The newest id by name carries the OLDEST signature: only an ordered query puts it in the first 400.
        await db.update(schema.agreementRequests).set({ signedAt: new Date(Date.UTC(2013, 0, 1)) }).where(eq(schema.agreementRequests.id, 'req-0449'));
        await runRetentionSweep(db as never, NOW, { photos: bucket });
        const row = await db.select({ purgedAt: schema.agreementRequests.purgedAt }).from(schema.agreementRequests).where(eq(schema.agreementRequests.id, 'req-0449')).get();
        expect(row?.purgedAt).not.toBeNull();
        expect(await purged()).toBe(400);
    });

    it('a bucket delete that keeps failing skips only its own chunk: nothing in it is marked, the rest goes on, and the failure is counted and logged with ids only', async () => {
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const failing = { delete: async (keys: string[]) => {
            if (keys.some((k) => k.includes('req-0000'))) throw new Error('R2 down\nkey: jane@example.com');
        } } as unknown as R2Bucket;
        const first = await runRetentionSweep(db as never, NOW, { photos: failing });
        expect(first.failedChunks).toBe(1);
        expect(first.purgedEnvelopes).toBe(400 - 40);
        const stuck = await db.select({ id: schema.agreementRequests.id, purgedAt: schema.agreementRequests.purgedAt }).from(schema.agreementRequests).where(isNull(schema.agreementRequests.purgedAt)).all();
        expect(stuck.map((r) => r.id)).toContain('req-0000');
        const logged = error.mock.calls.find((c) => c[0] === 'retention.sweep.chunk.failed');
        expect(logged).toBeTruthy();
        expect(JSON.stringify(logged)).toContain('req-0000');
        expect(JSON.stringify(logged)).not.toContain('jane@example.com');
        // Every later run still reaches the rest of the backlog.
        const second = await runRetentionSweep(db as never, NOW, { photos: failing });
        expect(second.failedChunks).toBe(1);
        expect(second.purgedEnvelopes).toBe(BACKLOG - 400 + 0);
        expect(await purged()).toBe(BACKLOG - 40);
    });

    it('no statement of a full chunk binds 100 values or more (D1 refuses that; the test database does not)', async () => {
        const seen: number[] = [];
        const counted = drizzleSqlite(rawSqlite, { schema, logger: { logQuery: (_query: string, params: unknown[]) => { seen.push(params.length); } } });
        await runRetentionSweep(counted as never, NOW, { photos: bucket });
        expect(seen.length).toBeGreaterThan(20);
        // Control: the ids of a whole chunk are among the bound values, so the count is not trivially small.
        expect(Math.max(...seen)).toBeGreaterThanOrEqual(40);
        expect(seen.filter((n) => n >= 100)).toEqual([]);
    });

});
