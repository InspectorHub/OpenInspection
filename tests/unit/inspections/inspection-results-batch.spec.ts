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
    /**
     * `itemAttribute` — the field the whole item-attributes panel writes through.
     *
     * It was in the enum and had NO fold: the header used to send this shape to
     * `InspectionService.patchItem`, a method that no longer exists anywhere in
     * the repository, so it fell through to the scalar branch and wrote
     * `entry.itemAttribute`. Nothing reads that key. Every reader — the editor's
     * panel, and all 47 statutory `item_attribute` bindings — reads
     * `entry.attributes[<attributeId>]`.
     */
    it('folds an itemAttribute patch into entry.attributes under its own id', async () => {
        const res = await applyResultsBatch(asD1Db(db), 'i-1', [{
            itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
            value: { attributeId: 'damage_signs', value: 'cupping_curling' },
        }], { tenantId: 't-1' });
        expect(res.applied).toBe(1);

        const row = await db.select().from(inspectionResults).get();
        const data = row!.data as Record<string, Record<string, unknown>>;
        const entry = data['_default:roof:roof_predominant'];
        expect(entry).toBeDefined();
        expect(entry.attributes).toEqual({ damage_signs: 'cupping_curling' });
        // NEGATIVE CONTROL — the key nobody reads must not be written as well.
        expect(entry.itemAttribute).toBeUndefined();
    });

    it('MERGES a second attribute rather than replacing the first', async () => {
        // One dropdown sends one attribute and an item declares up to twelve.
        // A whole-object write would clear every answer beside the newest one,
        // which on a statutory form is a blank box that reads as unanswered.
        await applyResultsBatch(asD1Db(db), 'i-1', [{
            itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
            value: { attributeId: 'damage_signs', value: 'cupping_curling' },
        }], { tenantId: 't-1' });
        await applyResultsBatch(asD1Db(db), 'i-1', [{
            itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
            value: { attributeId: 'overall_condition', value: 'satisfactory' },
        }], { tenantId: 't-1' });

        const row = await db.select().from(inspectionResults).get();
        const data = row!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:roof:roof_predominant'].attributes).toEqual({
            damage_signs: 'cupping_curling',
            overall_condition: 'satisfactory',
        });
    });

    it('overwrites the SAME attribute, so a corrected answer wins', async () => {
        for (const value of ['cracking', 'cupping_curling']) {
            await applyResultsBatch(asD1Db(db), 'i-1', [{
                itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
                value: { attributeId: 'damage_signs', value },
            }], { tenantId: 't-1' });
        }
        const row = await db.select().from(inspectionResults).get();
        const data = row!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:roof:roof_predominant'].attributes)
            .toEqual({ damage_signs: 'cupping_curling' });
    });

    it('refuses a patch that does not name which attribute it answers', async () => {
        // Silently writing an unnamed answer is how one arrives on a statutory
        // form under the wrong question.
        await expect(applyResultsBatch(asD1Db(db), 'i-1', [{
            itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
            value: 'cupping_curling',
        }], { tenantId: 't-1' })).rejects.toThrow(/attributeId/);
    });

    it('leaves a cleared answer as null rather than dropping the key', async () => {
        // "—" is an answer of nothing, and on a form an absent key and an empty
        // one are different facts (see statutory values.ts).
        await applyResultsBatch(asD1Db(db), 'i-1', [{
            itemId: 'roof_predominant', sectionId: 'roof', field: 'itemAttribute',
            value: { attributeId: 'damage_signs', value: null },
        }], { tenantId: 't-1' });
        const row = await db.select().from(inspectionResults).get();
        const data = row!.data as Record<string, Record<string, unknown>>;
        expect(data['_default:roof:roof_predominant'].attributes)
            .toEqual({ damage_signs: null });
    });
});
