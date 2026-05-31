import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { TemplateMigrationService } from '../../src/services/template-migration.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import { tenantMarketplaceImportHistory } from '../../src/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const USER = 'user-1';

function buildSchema(itemIds: string[]) {
    return JSON.stringify({
        schemaVersion: 2,
        sections: [{
            id: 'sec1',
            title: 'S',
            items: itemIds.map((id) => ({
                id, label: id, type: 'rich' as const,
                ratingOptions: ['Inspected', 'Repair'],
                tabs: { information: [], limitations: [], defects: [] },
            })),
        }],
    });
}

async function seedTemplate(testDb: BetterSQLite3Database<typeof schema>, opts: {
    id?: string; tenantId?: string; itemIds: string[];
}) {
    const id = opts.id ?? crypto.randomUUID();
    await testDb.insert(schema.templates).values({
        id,
        tenantId: opts.tenantId ?? TENANT,
        name: 'T-' + id.slice(0, 4),
        schema: buildSchema(opts.itemIds),
        createdAt: new Date(),
    });
    return id;
}

async function seedInspection(testDb: BetterSQLite3Database<typeof schema>, opts: {
    templateId: string; tenantId?: string; results: Record<string, unknown>;
}) {
    const inspectionId = crypto.randomUUID();
    await testDb.insert(schema.inspections).values({
        id: inspectionId,
        tenantId: opts.tenantId ?? TENANT,
        propertyAddress: '1 Main St',
        templateId: opts.templateId,
        date: new Date().toISOString(),
        createdAt: new Date(),
    });
    await testDb.insert(schema.inspectionResults).values({
        id: crypto.randomUUID(),
        tenantId: opts.tenantId ?? TENANT,
        inspectionId,
        // Drizzle mode:'json' stringifies objects on insert and parses on select.
        // Pass the object directly so the round-trip matches production.
        data: opts.results as never,
        lastSyncedAt: new Date(),
    });
    return inspectionId;
}

describe('TemplateMigrationService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: TemplateMigrationService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', subdomain: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'O', subdomain: 'o', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new TemplateMigrationService({} as any, TENANT);
    });

    describe('preview()', () => {
        it('returns affected count and breaking items when result keys are removed', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a', 'b', 'c'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a', 'b'] });
            await seedInspection(testDb, { templateId: oldId, results: { a: { rating: 'OK' }, c: { rating: 'Repair' } } });
            await seedInspection(testDb, { templateId: oldId, results: { a: { rating: 'OK' }, b: { rating: 'OK' } } });

            const preview = await svc.preview(oldId, newId);
            expect(preview.affected).toBe(2);
            expect(preview.breakingItems).toHaveLength(1);
            expect(preview.breakingItems[0].missingItems).toEqual(['c']);
            expect(preview.compatibleItems).toHaveLength(1);
        });

        it('throws NotFound for templates outside tenant', async () => {
            const oldId = await seedTemplate(testDb, { tenantId: OTHER_TENANT, itemIds: ['a'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            await expect(svc.preview(oldId, newId)).rejects.toThrow(/not found/i);
        });
    });

    describe('migrate()', () => {
        it('refuse_incompatible throws 422 when breaking items present', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a', 'c'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            await seedInspection(testDb, { templateId: oldId, results: { a: 'OK', c: 'Repair' } });

            await expect(svc.migrate(oldId, newId, 'refuse_incompatible', USER)).rejects.toMatchObject({
                status: 422,
            });
        });

        it('preserve_unknown moves removed-item data to _legacy', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a', 'c'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            const insId = await seedInspection(testDb, { templateId: oldId, results: { a: { v: 1 }, c: { v: 9 } } });

            const result = await svc.migrate(oldId, newId, 'preserve_unknown', USER);
            expect(result.migrated).toBe(1);

            const ins = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, insId)).get();
            expect(ins!.templateId).toBe(newId);

            const data = await testDb.select().from(schema.inspectionResults)
                .where(eq(schema.inspectionResults.inspectionId, insId)).get();
            const parsed = typeof data!.data === 'string' ? JSON.parse(data!.data) : data!.data;
            expect(parsed.a).toEqual({ v: 1 });
            expect(parsed._legacy).toEqual({ c: { v: 9 } });
        });

        it('force drops unknown data without _legacy bucket', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a', 'c'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            const insId = await seedInspection(testDb, { templateId: oldId, results: { a: 1, c: 9 } });

            await svc.migrate(oldId, newId, 'force', USER);
            const data = await testDb.select().from(schema.inspectionResults)
                .where(eq(schema.inspectionResults.inspectionId, insId)).get();
            const parsed = typeof data!.data === 'string' ? JSON.parse(data!.data) : data!.data;
            expect(parsed.a).toBe(1);
            expect(parsed._legacy).toBeUndefined();
        });

        it('dryRun does not mutate inspections', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            const insId = await seedInspection(testDb, { templateId: oldId, results: { a: 'X' } });

            const result = await svc.migrate(oldId, newId, 'preserve_unknown', USER, { dryRun: true });
            expect(result.dryRun).toBe(true);

            const ins = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, insId)).get();
            // Unchanged — still pointing at oldId
            expect(ins!.templateId).toBe(oldId);
        });

        it('writes a history row on success', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            await seedInspection(testDb, { templateId: oldId, results: { a: 'X' } });

            await svc.migrate(oldId, newId, 'preserve_unknown', USER);
            const history = await testDb.select().from(tenantMarketplaceImportHistory)
                .where(and(
                    eq(tenantMarketplaceImportHistory.tenantId, TENANT),
                    eq(tenantMarketplaceImportHistory.action, 'migrate'),
                )).all();
            expect(history).toHaveLength(1);
            expect(history[0].rowsAffected).toBe(1);
            expect(history[0].createdBy).toBe(USER);
            const meta = JSON.parse(history[0].metadata as string);
            expect(meta.fromTemplateId).toBe(oldId);
            expect(meta.toTemplateId).toBe(newId);
        });

        it('refuses to migrate templates from a different tenant', async () => {
            const oldId = await seedTemplate(testDb, { tenantId: OTHER_TENANT, itemIds: ['a'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            await expect(svc.migrate(oldId, newId, 'preserve_unknown', USER)).rejects.toThrow(/not found/i);
        });

        it('deleteOldTemplate removes old template after successful migration', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a'] });
            const newId = await seedTemplate(testDb, { itemIds: ['a'] });
            await seedInspection(testDb, { templateId: oldId, results: { a: 'X' } });

            await svc.migrate(oldId, newId, 'preserve_unknown', USER, { deleteOldTemplate: true });
            const old = await testDb.select().from(schema.templates).where(eq(schema.templates.id, oldId)).get();
            expect(old).toBeUndefined();
        });

        it('tryDeleteOldTemplate refuses to delete when an inspection still references the old template', async () => {
            // Drives the post-migrate delete gate directly so the concurrent-
            // insert race is reproducible. If any inspection still points at
            // oldId, the helper returns false and leaves the row intact.
            const oldId = await seedTemplate(testDb, { itemIds: ['a'] });
            await testDb.insert(schema.inspections).values({
                id: crypto.randomUUID(), tenantId: TENANT,
                propertyAddress: 'race-orphan', templateId: oldId, date: '2026-05-08',
                createdAt: new Date(),
            });

            const deleted = await svc.tryDeleteOldTemplate(oldId);
            expect(deleted).toBe(false);

            const old = await testDb.select().from(schema.templates).where(eq(schema.templates.id, oldId)).get();
            expect(old).toBeTruthy();
        });

        it('tryDeleteOldTemplate deletes when no inspection references the template', async () => {
            const oldId = await seedTemplate(testDb, { itemIds: ['a'] });
            const deleted = await svc.tryDeleteOldTemplate(oldId);
            expect(deleted).toBe(true);
            const old = await testDb.select().from(schema.templates).where(eq(schema.templates.id, oldId)).get();
            expect(old).toBeUndefined();
        });
    });
});
