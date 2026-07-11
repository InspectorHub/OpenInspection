/**
 * Commercial PCA Phase U (Batch C-lazy) — per-unit LAZY read-slicing.
 *
 * The GET /api/inspections/:id/results handler takes an OPTIONAL `?scope`
 * query param. When present it read-slices the stored `data` map to just that
 * scope's findings via `findingsForUnit(data, scope)`; when omitted it returns
 * the full map unchanged (backward compatible for every existing caller).
 *
 * This test seeds a real `inspection_results` row (better-sqlite3), reads it
 * back through the SAME drizzle query the handler uses, and applies the SAME
 * `scope ? findingsForUnit(data, scope) : data` expression the handler applies
 * (see the getResultsRoute handler in server/api/inspections/results.ts, which
 * calls exactly `findingsForUnit(data, scope)`). It asserts the three cases:
 *   - scope='_default' → only the '_default:' keys
 *   - scope='u1'       → only the 'u1:' keys
 *   - omitted          → ALL keys, unchanged
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { inspectionResults } from '../../../server/lib/db/schema';
import { findingsForUnit } from '../../../server/lib/finding-key';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';

// Findings map spanning the common scope plus two per-unit scopes.
const DATA: Record<string, unknown> = {
    '_default:s1:i1': { rating: 'good', note: 'common' },
    'u1:s1:i1': { rating: 'poor', note: 'unit 1' },
    'u2:s1:i1': { rating: 'fair', note: 'unit 2' },
};

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    await testDb.insert(schema.inspectionResults).values({
        id: 'result-1', tenantId: TENANT, inspectionId: INSPECTION,
        data: DATA, lastSyncedAt: new Date(),
    });
}

describe('GET /inspections/:id/results — ?scope read-slicing (Phase U C-lazy)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await seed(testDb);
    });

    // Mirror the handler's tenant-scoped read + slice expression exactly.
    async function readResults(scope?: string): Promise<Record<string, unknown>> {
        const row = await testDb.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, INSPECTION), eq(inspectionResults.tenantId, TENANT)))
            .get();
        const data = (row?.data || {}) as Record<string, unknown>;
        return scope ? findingsForUnit(data, scope) : data;
    }

    it("scope='_default' returns only the common-scope findings", async () => {
        const out = await readResults('_default');
        expect(Object.keys(out).sort()).toEqual(['_default:s1:i1']);
        expect(out['_default:s1:i1']).toEqual({ rating: 'good', note: 'common' });
    });

    it("scope='u1' returns only unit 1's findings", async () => {
        const out = await readResults('u1');
        expect(Object.keys(out).sort()).toEqual(['u1:s1:i1']);
        expect(out['u1:s1:i1']).toEqual({ rating: 'poor', note: 'unit 1' });
    });

    it("scope='u2' returns only unit 2's findings", async () => {
        const out = await readResults('u2');
        expect(Object.keys(out).sort()).toEqual(['u2:s1:i1']);
    });

    it('omitted scope returns the FULL map unchanged (backward compatible)', async () => {
        const out = await readResults();
        expect(Object.keys(out).sort()).toEqual(['_default:s1:i1', 'u1:s1:i1', 'u2:s1:i1']);
        expect(out).toEqual(DATA);
    });
});
