/**
 * Task 2 — RepairRequestService: CRUD + credit total + creator auth
 *
 * Harness mirrors contractor-type.service.spec.ts:
 *   - vi.mock drizzle-orm/d1 → in-memory better-sqlite3 via createTestDb
 *   - service constructed with {} as D1Database (mockDrizzle intercepts calls)
 *   - genId / now injected for determinism
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RepairRequestService } from '../../../server/services/repair-request.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
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
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(65000);
    });

    it('creditTotal treats null requestedCreditCents as 0', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'agent', ref: 'u1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: null,
        });
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(0);
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

    // IA-57 — the share page is a snapshot document: the trade must be frozen
    // onto the item row at add time, not re-joined from the (mutable) report.
    it('addItem persists the trade snapshot and getByShareToken returns it', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-trade', sectionTitle: 'Roof', itemLabel: 'Shingles',
            trade: 'licensed roofer',
        });
        const got = await svc.getByShareToken(rr.shareToken);
        expect(got?.items[0]!.tradeSnapshot).toBe('licensed roofer');
    });

    it('addItem re-add updates the trade snapshot in place', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-trade', sectionTitle: 'Roof', itemLabel: 'Shingles',
            trade: 'licensed roofer',
        });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-trade', sectionTitle: 'Roof', itemLabel: 'Shingles',
            trade: 'general contractor',
        });
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.items).toHaveLength(1);
        expect(got?.items[0]!.tradeSnapshot).toBe('general contractor');
    });

    // #275 — three separate places write this column (insert, the idempotent
    // re-add patch, and updateItem's closed allow-list), and each one is written
    // out field by field, so each is its own chance to silently drop the tag.
    it('addItem persists the action tag and it reads back off the row', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-tag', sectionTitle: 'Roof', itemLabel: 'Shingles',
            repairActionTag: 'replace',
        });
        const got = await svc.getByShareToken(rr.shareToken);
        expect(got?.items[0]!.repairActionTag).toBe('replace');
    });

    it('addItem re-add updates the action tag in place — the idempotent path', async () => {
        // Toggle a defect off and on, or reload the builder: the second add takes
        // the UPDATE branch, whose patch object is a hand-written field list.
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-tag', sectionTitle: 'Roof', itemLabel: 'Shingles',
            repairActionTag: 'repair',
        });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-tag', sectionTitle: 'Roof', itemLabel: 'Shingles',
            repairActionTag: 'fund',
        });
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.items).toHaveLength(1);
        expect(got?.items[0]!.repairActionTag).toBe('fund');
    });

    /**
     * ⚠️ This proves updateItem WRITES the tag; it does not prove the allow-list.
     * Verified by breaking it: narrowing `Partial<Pick<ItemInput, …>>` back to
     * credit+note leaves this test GREEN — drizzle's `.set()` forwards whatever
     * the object holds, so the closed allow-list is enforced by `type-check:api`
     * (which does fail, at the route's patch assignment), not at runtime.
     */
    it('updateItem patches the action tag', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const item = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-tag', sectionTitle: 'Roof', itemLabel: 'Shingles',
        });
        expect(item.repairActionTag ?? null).toBeNull();
        await svc.updateItem(TENANT, INSP, rr.id, item.id, { repairActionTag: 'other' });
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.items[0]!.repairActionTag).toBe('other');
    });

    it('an untagged item stays valid — null is the pre-#275 state, not a defect', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'inspector', ref: 'u-insp' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-none', sectionTitle: 'Roof', itemLabel: 'Shingles',
        });
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.items[0]!.repairActionTag).toBeNull();
    });

    it('getByShareToken returns null for unknown token', async () => {
        const got = await svc.getByShareToken('nonexistent-token');
        expect(got).toBeNull();
    });

    it('assertCanEdit rejects a different creator', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await expect(
            svc.assertCanEdit(TENANT, INSP, rr.id, { kind: 'client', ref: 'OTHER' }),
        ).rejects.toThrow();
        await expect(
            svc.assertCanEdit(TENANT, INSP, rr.id, { kind: 'client', ref: 'r1' }),
        ).resolves.toBeTruthy();
    });

    it('assertCanEdit throws on non-existent request', async () => {
        await expect(
            svc.assertCanEdit(TENANT, INSP, 'ghost-id', { kind: 'inspector', ref: 'u1' }),
        ).rejects.toThrow();
    });

    it('updateItem changes a credit and creditTotal reflects it', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const item = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        await svc.updateItem(TENANT, INSP, rr.id, item.id, { requestedCreditCents: 30000 });
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(30000);
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
        await svc.removeItem(TENANT, INSP, rr.id, item1.id);
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(15000);
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.items.map(i => i.id)).not.toContain(item1.id);
        expect(got?.items.map(i => i.id)).toContain(item2.id);
    });

    it('setIntro updates customIntro', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'inspector', ref: 'ins-1' });
        await svc.setIntro(TENANT, INSP, rr.id, 'Please fix these items.');
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got?.request.customIntro).toBe('Please fix these items.');
    });

    it('get returns null for unknown id', async () => {
        const got = await svc.get(TENANT, INSP, 'ghost');
        expect(got).toBeNull();
    });

    // -------------------------------------------------------------------------
    // B1: addItem idempotency (app-level dedup)
    // -------------------------------------------------------------------------

    it('B1: addItem twice with same (rrId, findingKey) → only ONE row, second call updates', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-dedup',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
            requestedCreditCents: 50000,
            note: 'first note',
        });
        // Second call — same findingKey, different credit/note
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-dedup',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
            requestedCreditCents: 30000,
            note: 'updated note',
        });

        const got = await svc.get(TENANT, INSP, rr.id);
        const rows = got!.items.filter(i => i.findingKey === 'k-dedup');
        expect(rows).toHaveLength(1);
        expect(rows[0].requestedCreditCents).toBe(30000);
        expect(rows[0].note).toBe('updated note');
    });

    it('B1: creditTotal after duplicate addItem reflects ONE credit (not doubled)', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-dup',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k-dup',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        // Must be 50000, not 100000
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(50000);
    });

    // -------------------------------------------------------------------------
    // I1: service methods scoped to (tenantId, inspectionId)
    // -------------------------------------------------------------------------

    it('I1: get(tenantId, inspectionId, id) → null when inspectionId does not match', async () => {
        const rrA = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        // Request belongs to INSP; asking for OTHER_INSP must return null
        const got = await svc.get(TENANT, OTHER_INSP, rrA.id);
        expect(got).toBeNull();
    });

    it('I1: assertCanEdit(tenantId, inspectionId, id, creator) → throws when inspectionId does not match', async () => {
        const rrA = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        await expect(
            svc.assertCanEdit(TENANT, OTHER_INSP, rrA.id, { kind: 'client', ref: 'r1' }),
        ).rejects.toThrow();
    });

    it('I1: updateItem(tenantId, inspectionId, ...) → no-op when inspectionId does not match', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const item = await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        // updateItem on wrong inspection must not modify the real item
        await svc.updateItem(TENANT, OTHER_INSP, rr.id, item.id, { requestedCreditCents: 1 });
        expect(await svc.creditTotal(TENANT, INSP, rr.id)).toBe(50000);
    });

    it('I1: removeItem(tenantId, inspectionId, ...) → no-op when inspectionId does not match', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        await svc.removeItem(TENANT, OTHER_INSP, rr.id, 'nonexistent-item');
        // Item still exists
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got!.items).toHaveLength(1);
    });

    it('I1: setIntro(tenantId, inspectionId, ...) → no-op when inspectionId does not match', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        await svc.setIntro(TENANT, OTHER_INSP, rr.id, 'hacked intro');
        const got = await svc.get(TENANT, INSP, rr.id);
        expect(got!.request.customIntro).toBeNull();
    });

    it('I1: creditTotal(tenantId, inspectionId, id) → 0 when inspectionId does not match', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'r1' });
        await svc.addItem(TENANT, rr.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles',
            requestedCreditCents: 50000,
        });
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        expect(await svc.creditTotal(TENANT, OTHER_INSP, rr.id)).toBe(0);
    });
});

/**
 * #69 — `listForInspection`, the Repair Request Log's read.
 *
 * Its whole reason to exist is that it does NOT filter by creator, which makes
 * it the one read on this service that could hand a caller somebody else's
 * list. The tests below therefore pin both halves: that it crosses the creator
 * boundary on purpose, and that it crosses no other boundary by accident.
 */
describe('RepairRequestService.listForInspection (#69)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: RepairRequestService;

    beforeEach(async () => {
        const f = createTestDb();
        testDb = f.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(f.sqlite);
        await seedTenant(testDb);
        svc = makeRepairRequestService(testDb);
    });

    it('returns lists from EVERY creator, which listMine by design does not', async () => {
        const buyer = await svc.create(TENANT, INSP, { kind: 'client', ref: 'buyer@example.com' });
        const agent = await svc.create(TENANT, INSP, { kind: 'agent', ref: 'agent@example.com' });

        // The contrast is the assertion: same tenant, same inspection, and the
        // creator-scoped read sees one of the two.
        const mine = await svc.listMine(TENANT, INSP, { kind: 'client', ref: 'buyer@example.com' });
        expect(mine.map((r) => r.id)).toEqual([buyer.id]);

        const log = await svc.listForInspection(TENANT, INSP);
        expect(log.map((r) => r.id).sort()).toEqual([agent.id, buyer.id].sort());
    });

    it('newest list first — the log is read to find the latest ask', async () => {
        const first = await svc.create(TENANT, INSP, { kind: 'client', ref: 'a' });
        const second = await svc.create(TENANT, INSP, { kind: 'client', ref: 'b' });
        // The injected clock advances per generated id, so `second` is newer.
        const log = await svc.listForInspection(TENANT, INSP);
        expect(log.map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it('never crosses to another inspection in the same tenant', async () => {
        const OTHER_INSP = '22222222-2222-2222-2222-222222222222';
        await svc.create(TENANT, INSP, { kind: 'client', ref: 'a' });
        const elsewhere = await svc.create(TENANT, OTHER_INSP, { kind: 'client', ref: 'a' });
        const log = await svc.listForInspection(TENANT, INSP);
        expect(log.map((r) => r.id)).not.toContain(elsewhere.id);
    });

    it('never crosses to another tenant', async () => {
        const OTHER_TENANT = '00000000-0000-0000-0000-0000000000ff';
        await svc.create(TENANT, INSP, { kind: 'client', ref: 'a' });
        const foreign = await svc.create(OTHER_TENANT, INSP, { kind: 'client', ref: 'a' });
        const log = await svc.listForInspection(TENANT, INSP);
        expect(log.map((r) => r.id)).not.toContain(foreign.id);
    });

    it('attaches each list its OWN items and nobody else\'s', async () => {
        // One query fetches the items for every list and groups them in memory,
        // so a mis-grouped bucket would put the agent's asks under the buyer's
        // name — the failure mode a per-row fetch cannot have.
        const buyer = await svc.create(TENANT, INSP, { kind: 'client', ref: 'buyer' });
        const agent = await svc.create(TENANT, INSP, { kind: 'agent', ref: 'agent' });
        await svc.addItem(TENANT, buyer.id, {
            findingKey: 'k1', sectionTitle: 'Roof', itemLabel: 'Shingles', note: 'buyer note',
        });
        await svc.addItem(TENANT, agent.id, {
            findingKey: 'k2', sectionTitle: 'HVAC', itemLabel: 'Furnace', note: 'agent note',
        });

        const log = await svc.listForInspection(TENANT, INSP);
        const byId = new Map(log.map((r) => [r.id, r]));
        expect(byId.get(buyer.id)!.items.map((i) => i.note)).toEqual(['buyer note']);
        expect(byId.get(agent.id)!.items.map((i) => i.note)).toEqual(['agent note']);
    });

    it('returns an empty array — not a query — when the inspection has no lists', async () => {
        expect(await svc.listForInspection(TENANT, INSP)).toEqual([]);
    });
});
