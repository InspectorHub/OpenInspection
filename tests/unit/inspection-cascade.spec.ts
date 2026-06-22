/**
 * deleteInspectionCascade — hard-delete an inspection and every row + R2 asset
 * it owns. D1 does not enforce FK cascades at runtime, so a bare inspection
 * delete orphans children (incl. still-resolvable access tokens) and leaks R2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { deleteInspectionCascade } from '../../server/services/inspection/inspection-cascade';
import { inspectionScopedTables } from '../../server/lib/db/scoped-tables';
import { getTableName } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';

function makeR2(objects: { key: string; size: number }[]) {
    const deleted: string[] = [];
    return {
        bucket: {
            list: async (opts?: { prefix?: string }) => ({
                objects: opts?.prefix ? objects.filter(o => o.key.startsWith(opts.prefix!)) : objects,
                truncated: false,
                cursor: undefined,
            }),
            delete: async (keys: string[] | string) => { deleted.push(...(Array.isArray(keys) ? keys : [keys])); },
        } as unknown as R2Bucket,
        deleted,
    };
}

describe('deleteInspectionCascade', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    it('deletes the inspection, its child rows, and its R2 assets', async () => {
        // Seed representative children that a bare delete used to orphan.
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-1', tenantId: TENANT, inspectionId: INSP, data: '{}',
            lastSyncedAt: new Date(), createdAt: new Date(),
        } as never);
        await testDb.insert(schema.invoices).values({
            id: 'inv-1', tenantId: TENANT, inspectionId: INSP, amountCents: 5000,
            lineItems: [{ description: 'x', amountCents: 5000 }], createdAt: new Date(),
        } as never);
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: 'tok-1', tenantId: TENANT, inspectionId: INSP, recipientEmail: 'jane@test.com',
            role: 'client', token: crypto.randomUUID(), createdAt: Date.now(),
        } as never);
        await testDb.insert(schema.inspectionMessages).values({
            id: 'msg-1', tenantId: TENANT, inspectionId: INSP, fromRole: 'client',
            body: 'hi', createdAt: Date.now(),
        } as never);

        const photoKey = `${TENANT}/inspections/${INSP}/photos/m-1.jpg`;
        const otherInspKey = `${TENANT}/inspections/i-2/photos/m-9.jpg`;
        const r2 = makeR2([{ key: photoKey, size: 100 }, { key: otherInspKey, size: 100 }]);

        await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP);

        expect(await testDb.select().from(schema.inspections).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionResults).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.invoices).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionAccessTokens).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionMessages).all()).toHaveLength(0);
        // R2: only THIS inspection's prefix is swept; a sibling inspection survives.
        expect(r2.deleted).toContain(photoKey);
        expect(r2.deleted).not.toContain(otherInspKey);
    });

    it('the derived inspection-scoped set covers child tables but not `inspections` itself', () => {
        const names = new Set(inspectionScopedTables().map(getTableName));
        for (const t of ['inspection_results', 'invoices', 'inspection_access_tokens', 'inspection_messages']) {
            expect(names.has(t), `cascade must cover ${t}`).toBe(true);
        }
        expect(names.has('inspections')).toBe(false);
    });
});
