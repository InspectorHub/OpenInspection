/**
 * Task 2 — RepairRequestService: CRUD + credit total + creator auth
 *
 * Harness mirrors contractor-type.service.spec.ts:
 *   - vi.mock drizzle-orm/d1 → in-memory better-sqlite3 via createTestDb
 *   - service constructed with {} as D1Database (mockDrizzle intercepts calls)
 *   - genId / now injected for determinism
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RepairRequestService } from '../../server/services/repair-request.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP   = '11111111-1111-1111-1111-111111111111';

let idSeq = 0;
function makeRepairRequestService(db: BetterSQLite3Database<typeof schema>) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    idSeq = 0;
    const genId = () => `id-${++idSeq}`;
    const now = () => 1_700_000_000_000 + idSeq * 1000;
    return new RepairRequestService({} as D1Database, genId, now);
}

async function seedTenant(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5,
        appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date(),
    } as any);
}

describe('RepairRequestService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: RepairRequestService;

    beforeEach(async () => {
        const f = createTestDb();
        testDb = f.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(f.sqlite);
        await seedTenant(testDb);
        svc = makeRepairRequestService(testDb);
    });

    it('create → returns row with a shareToken; listMine finds it', async () => {
        const creator = { kind: 'client' as const, ref: 'recip-1' };
        const rr = await svc.create(TENANT, INSP, creator);
        expect(rr.shareToken).toBeTruthy();
        const mine = await svc.listMine(TENANT, INSP, creator);
        expect(mine.map(r => r.id)).toContain(rr.id);
    });

    it('listMine does not return rows from a different creator', async () => {
        await svc.create(TENANT, INSP, { kind: 'client', ref: 'recip-1' });
        const mine = await svc.listMine(TENANT, INSP, { kind: 'client', ref: 'OTHER' });
        expect(mine).toHaveLength(0);
    });

    it('addItem + creditTotal sums requestedCreditCents', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            commentSnapshot: 'worn', requestedCreditCents: 50000, note: 'replace',
        });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k2', sectionTitle: 'Elec', itemLabel: 'Panel',
            commentSnapshot: 'double tap', requestedCreditCents: 15000, note: null,
        });
        expect(await svc.creditTotal(TENANT, rr.id)).toBe(65000);
    });

    it('creditTotal treats null requestedCreditCents as 0', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'agent', ref: 'u1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: null,
        });
        expect(await svc.creditTotal(TENANT, rr.id)).toBe(0);
    });

    it('getByShareToken returns the list + items read-only', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'agent', ref: 'u9' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'f1', sectionTitle: 'Foundation', itemLabel: 'Crack',
        });
        const got = await svc.getByShareToken(rr.shareToken);
        expect(got?.request.id).toBe(rr.id);
        expect(got?.items).toHaveLength(1);
    });

    it('getByShareToken returns null for unknown token', async () => {
        const got = await svc.getByShareToken('nonexistent-token');
        expect(got).toBeNull();
    });

    it('assertCanEdit rejects a different creator', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await expect(
            svc.assertCanEdit(TENANT, rr.id, { kind: 'client', ref: 'OTHER' }),
        ).rejects.toThrow();
        await expect(
            svc.assertCanEdit(TENANT, rr.id, { kind: 'client', ref: 'r1' }),
        ).resolves.toBeTruthy();
    });

    it('assertCanEdit throws on non-existent request', async () => {
        await expect(
            svc.assertCanEdit(TENANT, 'ghost-id', { kind: 'inspector', ref: 'u1' }),
        ).rejects.toThrow();
    });

    it('updateItem changes a credit and creditTotal reflects it', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const item = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        await svc.updateItem(TENANT, rr.id, item.id, { requestedCreditCents: 30000 });
        expect(await svc.creditTotal(TENANT, rr.id)).toBe(30000);
    });

    it('removeItem drops an item and creditTotal reflects it', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const item1 = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        const item2 = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k2', sectionTitle: 'Elec', itemLabel: 'Panel',
            requestedCreditCents: 15000,
        });
        await svc.removeItem(TENANT, rr.id, item1.id);
        expect(await svc.creditTotal(TENANT, rr.id)).toBe(15000);
        const got = await svc.get(TENANT, rr.id);
        expect(got?.items.map(i => i.id)).not.toContain(item1.id);
        expect(got?.items.map(i => i.id)).toContain(item2.id);
    });

    it('setIntro updates customIntro', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'inspector', ref: 'ins-1' });
        await svc.setIntro(TENANT, rr.id, 'Please fix these items.');
        const got = await svc.get(TENANT, rr.id);
        expect(got?.request.customIntro).toBe('Please fix these items.');
    });

    it('get returns null for unknown id', async () => {
        const got = await svc.get(TENANT, 'ghost');
        expect(got).toBeNull();
    });
});
