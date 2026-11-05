/**
 * Sprint 3 S3-3 — TagService unit suite.
 *
 * Critical invariants:
 *   - seedDefaults inserts the five canonical tags + is idempotent
 *   - tenants cannot read each other's tags
 *   - cannot create duplicates within a tenant (UNIQUE constraint)
 *   - link / unlink round-trip + idempotent
 *   - getItemTags returns only the active item's links
 *   - countByTag aggregates across an inspection
 *   - delete cascades the item links
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger } from '../../../server/lib/logger';
import { TagService } from '../../../server/services/tag.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { d1For, lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const INSPECTION_X = '00000000-0000-0000-0000-0000000000aa';
const INSPECTION_Y = '00000000-0000-0000-0000-0000000000bb';
const ITEM_1 = 'item_1';
const ITEM_2 = 'item_2';

async function seedTenants(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
}

describe('TagService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: TagService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        testD1.use(testDb);
        svc = new TagService(testD1.binding);
        await seedTenants(testDb);
    });

    it('seeds the five canonical tags + is idempotent', async () => {
        const first = await svc.seedDefaults(TENANT_A);
        expect(first.inserted).toBe(5);
        expect(first.skipped).toBe(0);

        const second = await svc.seedDefaults(TENANT_A);
        expect(second.inserted).toBe(0);
        expect(second.skipped).toBe(5);

        const list = await svc.list(TENANT_A);
        expect(list.length).toBe(5);
        expect(list.every(t => t.isSeed)).toBe(true);
        const names = list.map(t => t.name).sort();
        expect(names).toEqual([
            'Critical',
            'Customer concern',
            'Inspector note',
            'Needs follow-up',
            'Waiting for client',
        ]);
    });

    it('isolates each tenant\'s tags', async () => {
        await svc.seedDefaults(TENANT_A);
        const aList = await svc.list(TENANT_A);
        const bList = await svc.list(TENANT_B);
        expect(aList.length).toBe(5);
        expect(bList.length).toBe(0);
    });

    it('creates a custom tag', async () => {
        const t = await svc.create(TENANT_A, { name: 'Reviewed', color: 'emerald' });
        expect(t.id).toBeTruthy();
        expect(t.name).toBe('Reviewed');
        expect(t.color).toBe('emerald');
        expect(t.isSeed).toBe(false);
    });

    it('rejects duplicate names within a tenant', async () => {
        await svc.create(TENANT_A, { name: 'Reviewed' });
        await expect(svc.create(TENANT_A, { name: 'Reviewed' })).rejects.toThrow();
    });

    it('allows the same name across tenants', async () => {
        await svc.create(TENANT_A, { name: 'Reviewed' });
        const b = await svc.create(TENANT_B, { name: 'Reviewed' });
        expect(b.tenantId).toBe(TENANT_B);
    });

    it('updates a tag', async () => {
        const t = await svc.create(TENANT_A, { name: 'Reviewed' });
        const u = await svc.update(t.id, TENANT_A, { name: 'Reviewed-2', color: 'rose' });
        expect(u.name).toBe('Reviewed-2');
        expect(u.color).toBe('rose');
    });

    it('refuses cross-tenant update', async () => {
        const t = await svc.create(TENANT_A, { name: 'Reviewed' });
        await expect(svc.update(t.id, TENANT_B, { name: 'X' })).rejects.toThrow();
    });

    it('links and unlinks a tag to an inspection item', async () => {
        const t = await svc.create(TENANT_A, { name: 'Reviewed' });

        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, t.id);
        const linked = await svc.getItemTags(TENANT_A, INSPECTION_X, ITEM_1);
        expect(linked.map(x => x.id)).toEqual([t.id]);

        // Re-link is idempotent
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, t.id);
        const stillOne = await svc.getItemTags(TENANT_A, INSPECTION_X, ITEM_1);
        expect(stillOne.length).toBe(1);

        await svc.unlinkFromItem(TENANT_A, INSPECTION_X, ITEM_1, t.id);
        const empty = await svc.getItemTags(TENANT_A, INSPECTION_X, ITEM_1);
        expect(empty.length).toBe(0);
    });

    it('getItemTags isolates by tenant', async () => {
        const tA = await svc.create(TENANT_A, { name: 'A1' });
        const tB = await svc.create(TENANT_B, { name: 'B1' });
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, tA.id);
        await svc.linkToItem(TENANT_B, INSPECTION_X, ITEM_1, tB.id);

        const aList = await svc.getItemTags(TENANT_A, INSPECTION_X, ITEM_1);
        expect(aList.map(x => x.name)).toEqual(['A1']);
    });

    it('countByTag aggregates link counts within an inspection', async () => {
        const t1 = await svc.create(TENANT_A, { name: 'T1' });
        const t2 = await svc.create(TENANT_A, { name: 'T2' });
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, t1.id);
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_2, t1.id);
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_2, t2.id);

        // Different inspection — should not contribute.
        await svc.linkToItem(TENANT_A, INSPECTION_Y, ITEM_1, t1.id);

        const counts = await svc.countByTag(TENANT_A, INSPECTION_X);
        expect(counts[t1.id]).toBe(2);
        expect(counts[t2.id]).toBe(1);
    });

    it('delete removes the tag and its item links', async () => {
        const t = await svc.create(TENANT_A, { name: 'Reviewed' });
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, t.id);
        await svc.delete(t.id, TENANT_A);

        const tags = await svc.list(TENANT_A);
        expect(tags.find(x => x.id === t.id)).toBeUndefined();

        const links = await svc.getItemTags(TENANT_A, INSPECTION_X, ITEM_1);
        expect(links.length).toBe(0);
    });

    describe('delete also unpins the tag', () => {
        const prefs = (pinnedTagIds: string[]) => ({ cloneDefault: 'rating_notes' as const, autoAdvanceDelayMs: 200, pinnedTagIds });
        const readPins = async (tenantId: string) =>
            (await testDb.select({ p: schema.tenantConfigs.inspectionPrefs }).from(schema.tenantConfigs)
                .where(eq(schema.tenantConfigs.tenantId, tenantId)).get())?.p?.pinnedTagIds;

        it('removes the deleted id from the company pins and keeps the others', async () => {
            const keep = await svc.create(TENANT_A, { name: 'Keep' });
            const gone = await svc.create(TENANT_A, { name: 'Gone' });
            await testDb.insert(schema.tenantConfigs).values({ tenantId: TENANT_A, updatedAt: new Date(), inspectionPrefs: prefs([keep.id, gone.id]) });
            await svc.delete(gone.id, TENANT_A);
            expect(await readPins(TENANT_A)).toEqual([keep.id]);
        });

        it('leaves the pins of a different company alone', async () => {
            const gone = await svc.create(TENANT_A, { name: 'Gone' });
            await testDb.insert(schema.tenantConfigs).values({ tenantId: TENANT_B, updatedAt: new Date(), inspectionPrefs: prefs([gone.id]) });
            await svc.delete(gone.id, TENANT_A);
            expect(await readPins(TENANT_B)).toEqual([gone.id]);
        });

        it('still deletes when the company has no prefs at all', async () => {
            const gone = await svc.create(TENANT_A, { name: 'Gone' });
            await expect(svc.delete(gone.id, TENANT_A)).resolves.toEqual({ deleted: true });
        });
    });

    it('listInspectionsByTag returns only matching inspection ids', async () => {
        const t = await svc.create(TENANT_A, { name: 'Critical' });
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_1, t.id);
        await svc.linkToItem(TENANT_A, INSPECTION_X, ITEM_2, t.id);
        await svc.linkToItem(TENANT_A, INSPECTION_Y, ITEM_1, t.id);

        const ids = await svc.listInspectionsByTag(TENANT_A, t.id);
        expect(ids.sort()).toEqual([INSPECTION_X, INSPECTION_Y].sort());
    });

    describe('listWithDefaults seeding log', () => {
        it('reports how many were inserted and how many were already there', async () => {
            await svc.create(TENANT_A, { name: 'Critical', color: 'rose' } as never);
            const info = vi.spyOn(logger, 'info');
            const out = await svc.listWithDefaults(TENANT_A);
            expect(out).toHaveLength(5);
            expect(info).toHaveBeenCalledWith('tags.seeded', { tenantId: TENANT_A, inserted: 4, skipped: 1 });
            info.mockRestore();
        });

        it('counts only what this call inserted when a concurrent first load got there first', async () => {
            // The first read of the tags table sees none; another request then inserts one before this call does.
            const real = d1For(testDb);
            let armed = true;
            const afterRead = () => {
                if (!armed) return;
                armed = false;
                testDb.insert(schema.tags).values({ id: 'raced', tenantId: TENANT_A, name: 'Critical', color: 'rose', isSeed: true, createdAt: new Date() }).run();
            };
            const wrap = (stmt: Record<string, unknown>): unknown => new Proxy(stmt, {
                get(target, prop) {
                    const value = target[prop as string] as (...a: unknown[]) => unknown;
                    if (prop === 'bind') return (...a: unknown[]) => wrap(value.apply(target, a) as Record<string, unknown>);
                    if (prop === 'raw' || prop === 'all' || prop === 'first' || prop === 'run') {
                        return async (...a: unknown[]) => { const out = await value.apply(target, a); afterRead(); return out; };
                    }
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            const racing = {
                prepare: (sql: string) => (armed && /from "tags"/i.test(sql) ? wrap(real.prepare(sql) as never) : real.prepare(sql)),
                batch: (list: never) => (real.batch as (l: never) => unknown)(list),
            } as unknown as D1Database;
            const racy = new TagService(racing);
            const info = vi.spyOn(logger, 'info');
            const out = await racy.listWithDefaults(TENANT_A);
            expect(out).toHaveLength(5);
            expect(info).toHaveBeenCalledWith('tags.seeded', { tenantId: TENANT_A, inserted: 4, skipped: 1 });
            info.mockRestore();
        });
    });
});
