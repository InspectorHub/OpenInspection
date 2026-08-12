import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, type TestDb } from '../helpers/test-db';
import { applyResultsBatch } from '../../../server/services/inspection-results.service';
import { inspections, inspectionResults, tenants } from '../../../server/lib/db/schema';

/**
 * Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.
 *
 * The service folds an array of patches into the inspection_results.data JSON
 * blob keyed by findingKey(DEFAULT_UNIT, sectionId, itemId), the same key the
 * single-field PATCH uses. Tests cover the three observable behaviours: insert
 * when no row exists, update when one does, and idempotent overwrite of the
 * same key.
 */

describe('applyResultsBatch', () => {
    let db: TestDb;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await db.insert(tenants).values({
            id: 't-1', slug: 'test', createdAt: new Date(),
        } as any);
        await db.insert(inspections).values({
            id: 'i-1',
            tenantId: 't-1',
            propertyAddress: '1 Test St',
            date: '2026-01-01',
            status: 'requested',
            createdAt: new Date(),
        } as any);
    });

    afterEach(() => {
        sqlite.close();
    });

    /**
     * `POST /api/inspections/{id}/results/batch` takes `value: z.any()` and
     * folds it onto the finding verbatim. It is an MCP `extended` tool with
     * `write` scope, so it is the widest hand-writable door into a finding —
     * no UI, no shape validation, straight to D1. The product stores no repair
     * price on a finding, and this endpoint had nothing stopping one.
     *
     * The nesting is deliberate: the price sits one object below the level a
     * naive strip would look at, which is the shape a real `defectFields`
     * patch has.
     */
    it('refuses to fold a repair price into a finding, at any depth', async () => {
        const value = {
            defects: [
                { cannedId: 'def-1', included: true, estimateLow: 50000, estimateHigh: 150000 },
            ],
            estimateMin: 250000,
        };
        // The payload really carries the money.
        expect(JSON.stringify(value)).toContain('150000');
        expect(JSON.stringify(value)).toContain('250000');

        const result = await applyResultsBatch(asD1Db(db), 'i-1', [
            { itemId: 'item-a', sectionId: 'sec-1', field: 'defectFields', value },
        ], { tenantId: 't-1' });
        expect(result.applied).toBe(1);

        const row = await db.select().from(inspectionResults).get();
        const stored = JSON.stringify(row!.data);
        expect(stored).not.toContain('50000');
        expect(stored).not.toContain('150000');
        expect(stored).not.toContain('250000');
        expect(stored).not.toContain('estimateLow');
        expect(stored).not.toContain('estimateMin');
        // The rest of the patch landed — the price is dropped, not the write.
        expect(stored).toContain('def-1');
    });

    it('inserts a new results row when none exists', async () => {
        const result = await applyResultsBatch(asD1Db(db), 'i-1', [
            { itemId: 'item-a', sectionId: 'sec-1', field: 'rating', value: 'good' },
            { itemId: 'item-b', sectionId: 'sec-1', field: 'notes', value: 'hello' },
        ], { tenantId: 't-1' });

        expect(result.applied).toBe(2);
        const row = await db.select().from(inspectionResults).get();
        expect(row).toBeDefined();
        const data = row!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:sec-1:item-a']?.rating).toBe('good');
        expect(data['_default:sec-1:item-b']?.notes).toBe('hello');
    });

    it('updates an existing row in place and overwrites the same key', async () => {
        await applyResultsBatch(asD1Db(db), 'i-1', [
            { itemId: 'item-a', sectionId: 'sec-1', field: 'rating', value: 'good' },
        ], { tenantId: 't-1' });
        const result = await applyResultsBatch(asD1Db(db), 'i-1', [
            { itemId: 'item-a', sectionId: 'sec-1', field: 'rating', value: 'defect' },
            { itemId: 'item-a', sectionId: 'sec-1', field: 'notes', value: 'cracked' },
        ], { tenantId: 't-1' });

        expect(result.applied).toBe(2);
        const rows = await db.select().from(inspectionResults).all();
        expect(rows).toHaveLength(1); // still upsert, not a second row
        const data = rows[0]!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:sec-1:item-a']?.rating).toBe('defect');
        expect(data['_default:sec-1:item-a']?.notes).toBe('cracked');
    });

    it('records provenance fields on each patched entry', async () => {
        await applyResultsBatch(asD1Db(db), 'i-1', [
            { itemId: 'item-a', sectionId: 'sec-1', field: 'rating', value: 'good' },
        ], { tenantId: 't-1', userId: 'user-99' });
        const row = await db.select().from(inspectionResults).get();
        const data = row!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:sec-1:item-a']?._lastWriter).toBe('user-99');
        expect(typeof data['_default:sec-1:item-a']?._lastWriteAt).toBe('number');
    });

    it('returns applied=0 for an empty patch list without touching the DB', async () => {
        const result = await applyResultsBatch(asD1Db(db), 'i-1', [], { tenantId: 't-1' });
        expect(result.applied).toBe(0);
        const rows = await db.select().from(inspectionResults).all();
        expect(rows).toHaveLength(0);
    });
});
