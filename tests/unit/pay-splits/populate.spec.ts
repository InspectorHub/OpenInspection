/**
 * Pay splits: populated once from tenant rules, then frozen (#278).
 *
 * The fixtures below are real writes against the real schema — in particular
 * the roster goes through `syncInspectionAssignments`, which has FULL-REPLACE
 * semantics. Passing only the newly added inspector deletes the others, and a
 * test that then asserts "the first two amounts are untouched" passes for the
 * wrong reason because those rows are gone. Every `assign()` here supplies the
 * whole roster.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import {
    tenants, users, services, inspections, inspectionServices,
    serviceInspectors, servicePayRules,
} from '../../../server/lib/db/schema';
import { syncInspectionAssignments } from '../../../server/lib/db/assignment-links';
import {
    populateSplits, getSplitsForLine, refreshSplits, previewRefresh,
    setSplitManually, exportPayroll, correctSplit, syncSplitsForInspection, findOrphanSplits,
} from '../../../server/services/pay-split.service';
import { createTestDb, setupSchema } from '../db';

const T = 't1';
const INSP = 'i1';
const LINE = 'line1';
const SVC = 'svc-home';
const RADON_LINE = 'line2';
const RADON = 'svc-radon';

describe('pay-split population', () => {
    let db: DrizzleD1Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
        const now = new Date();

        await db.insert(tenants).values({
            id: T, slug: 'acme', tier: 'free', status: 'active',
            maxUsers: 5, deploymentMode: 'shared', createdAt: now,
        }).run();
        for (const id of ['u1', 'u2', 'u3']) {
            await db.insert(users).values({
                id, tenantId: T, email: `${id}@acme.test`, passwordHash: 'x',
                name: id.toUpperCase(), role: 'inspector', createdAt: now,
            }).run();
        }
        await db.insert(services).values([
            { id: SVC, tenantId: T, name: 'Home Inspection', price: 50000, createdAt: now },
            { id: RADON, tenantId: T, name: 'Radon', price: 50000, createdAt: now },
        ]).run();
        await db.insert(inspections).values({
            id: INSP, tenantId: T, propertyAddress: '1 Oak St', date: '2026-08-01', createdAt: now,
        }).run();
        await db.insert(inspectionServices).values([
            { id: LINE, tenantId: T, inspectionId: INSP, serviceId: SVC, nameSnapshot: 'Home Inspection', priceSnapshot: 50000 },
            { id: RADON_LINE, tenantId: T, inspectionId: INSP, serviceId: RADON, nameSnapshot: 'Radon', priceSnapshot: 50000 },
        ]).run();
    });

    /** Full-replace roster write — the same call every production assignment path makes. */
    const assign = (lead: string, helpers: string[] = []) =>
        syncInspectionAssignments(db, T, INSP, { leadInspectorId: lead, helperInspectorIds: helpers });

    const qualify = (serviceId: string, userIds: string[]) =>
        db.insert(serviceInspectors).values(
            userIds.map(userId => ({ serviceId, userId, tenantId: T, createdAt: new Date() })),
        ).run();

    const setLine = (id: string, patch: { priceSnapshot?: number; priceOverride?: number | null; active?: boolean }) =>
        db.update(inspectionServices).set(patch)
            .where(and(eq(inspectionServices.tenantId, T), eq(inspectionServices.id, id))).run();

    const setRule = async (r: {
        serviceId?: string; userId?: string | null;
        type: 'percent' | 'fixed' | 'percent_after_deduction'; value: number; deductionCents?: number;
    }) => {
        const serviceId = r.serviceId ?? SVC;
        const userId = r.userId ?? null;
        await db.delete(servicePayRules).where(and(
            eq(servicePayRules.tenantId, T), eq(servicePayRules.serviceId, serviceId),
        )).run();
        await db.insert(servicePayRules).values({
            id: `rule-${serviceId}-${userId ?? 'default'}`, tenantId: T, serviceId, userId,
            type: r.type, value: r.value, deductionCents: r.deductionCents ?? null, createdAt: new Date(),
        }).run();
    };

    const splits = (lineId = LINE) => getSplitsForLine(db, T, lineId);

    it('assigns only inspectors qualified for that service', async () => {
        // Mirrors the competitor: auto-assign every inspector on the inspection
        // to the services they are not excluded from in Service Limitations.
        await qualify(RADON, ['u2']);                 // u1 is NOT qualified for radon
        await setRule({ serviceId: RADON, type: 'percent', value: 6000 });
        await assign('u1', ['u2']);
        await populateSplits(db, T, INSP);

        expect((await splits(RADON_LINE)).map(s => s.userId)).toEqual(['u2']);
    });

    it('computes a percent rule against the EFFECTIVE line price', async () => {
        // priceOverride ?? priceSnapshot — tier 2 of the money authority chain.
        await setLine(LINE, { priceSnapshot: 20000, priceOverride: 15000 });
        await setRule({ type: 'percent', value: 6000 });
        await assign('u1');
        await populateSplits(db, T, INSP);

        expect((await splits())[0].amountCents).toBe(9000);
    });

    it('DIVIDES the computed split by the number of inspectors on that line', async () => {
        // Mandatory and non-disableable at the competitor, for a reason: without
        // it, attaching a second inspector pays out 120% of the service.
        await setRule({ type: 'percent', value: 6000 });
        await assign('u1', ['u2']);
        await populateSplits(db, T, INSP);

        const rows = await splits();
        expect(rows).toHaveLength(2);
        expect(rows.map(s => s.amountCents)).toEqual([15000, 15000]);   // 30% each, not 60%
    });

    it('applies the deduction BEFORE the percentage', async () => {
        // percent_after_deduction is not a smaller percentage of the gross.
        await setRule({ type: 'percent_after_deduction', value: 6000, deductionCents: 10000 });
        await assign('u1');
        await populateSplits(db, T, INSP);

        expect((await splits())[0].amountCents).toBe(24000);            // (500 - 100) * 60%
    });

    it('skips a line that is no longer active', async () => {
        // `is_active` names pay splits as the reason it exists: a line declined
        // at the door survives because a report or a split may point at it, and
        // paying against it anyway is the failure the filter prevents.
        await setRule({ type: 'percent', value: 6000 });
        await assign('u1');
        await setLine(LINE, { active: false });
        await populateSplits(db, T, INSP);

        expect(await splits()).toHaveLength(0);
    });

    it('does NOT re-divide when a third inspector is added later', async () => {
        // Re-deriving on read would silently rewrite what the first two were paid.
        await setRule({ type: 'percent', value: 6000 });
        await assign('u1', ['u2']);
        await populateSplits(db, T, INSP);
        const before = (await splits()).map(s => s.amountCents);

        await assign('u1', ['u2', 'u3']);           // FULL roster — sync is full-replace
        await populateSplits(db, T, INSP);

        const after = await splits();
        expect(after.filter(s => ['u1', 'u2'].includes(s.userId)).map(s => s.amountCents)).toEqual(before);
        expect(after.find(s => s.userId === 'u3')?.amountCents).toBe(10000);   // 30000 / 3
    });

    it('does NOT recompute an existing split when the rule changes', async () => {
        // A rule edit that rewrites what someone was already paid is the failure
        // this whole design avoids.
        await setRule({ type: 'percent', value: 6000 });
        await assign('u1');
        await populateSplits(db, T, INSP);
        const before = (await splits())[0].amountCents;

        await setRule({ type: 'percent', value: 9000 });
        await populateSplits(db, T, INSP);

        expect((await splits())[0].amountCents).toBe(before);
    });

    it('refuses splits exceeding the line price', async () => {
        await setRule({ type: 'fixed', value: 999999 });
        await assign('u1');
        await expect(populateSplits(db, T, INSP)).rejects.toThrow(/exceed/i);
    });

    it('allows splits summing to LESS than the line price', async () => {
        // The remainder is company margin. Forcing 100% would model a co-op.
        await setRule({ type: 'percent', value: 5000 });
        await assign('u1');
        await expect(populateSplits(db, T, INSP)).resolves.toBe(1);     // only the line with a rule
        expect((await splits())[0].amountCents).toBe(25000);
    });

    describe('refresh', () => {
        beforeEach(async () => {
            await setLine(LINE, { priceOverride: 15000 });
            await setRule({ type: 'percent', value: 6000 });
            await assign('u1');
            await populateSplits(db, T, INSP);
        });

        it('re-derives from the current rules and roster, after showing what it would do', async () => {
            await setRule({ type: 'percent', value: 7000 });
            const preview = await previewRefresh(db, T, INSP);
            expect(preview).toContainEqual(expect.objectContaining({ from: 9000, to: 10500 }));

            await refreshSplits(db, T, INSP);
            expect((await splits())[0].amountCents).toBe(10500);
        });

        it('does NOT silently overwrite a manual amount', async () => {
            const id = (await splits())[0].id;
            await setSplitManually(db, T, id, 12345);
            await setRule({ type: 'percent', value: 7000 });
            await refreshSplits(db, T, INSP);

            expect((await splits())[0].amountCents).toBe(12345);        // a human chose this
        });

        it('REFUSES once a split is locked', async () => {
            await exportPayroll(db, T, { fromMs: 0, toMs: Date.now() + 1000 });
            await expect(refreshSplits(db, T, INSP)).rejects.toThrow(/locked|payroll/i);
        });
    });

    describe('payroll lock', () => {
        beforeEach(async () => {
            await setRule({ type: 'percent', value: 6000 });
            await assign('u1');
            await populateSplits(db, T, INSP);
        });

        it('makes a split read-only once exported', async () => {
            const id = (await splits())[0].id;
            await exportPayroll(db, T, { fromMs: 0, toMs: Date.now() + 1000 });
            await expect(setSplitManually(db, T, id, 999)).rejects.toThrow(/locked/i);
        });

        it('records a correction as a NEW row, leaving the original standing', async () => {
            const id = (await splits())[0].id;
            await exportPayroll(db, T, { fromMs: 0, toMs: Date.now() + 1000 });
            await correctSplit(db, T, id, { amountCents: -2000, reason: 'overpaid' });

            const rows = await splits();
            expect(rows).toHaveLength(2);
            expect(rows[0].id).toBe(id);
            expect(rows[0].lockedAt).not.toBeNull();
            expect(rows[0].amountCents).toBe(30000);                    // untouched
            expect(rows[1].correctsSplitId).toBe(id);
        });
    });

    describe('orphans', () => {
        it('drops a departed inspector\'s rule split but keeps their agreed one', async () => {
            await setRule({ type: 'percent', value: 4000 });
            await assign('u1', ['u2']);
            await populateSplits(db, T, INSP);
            const u2Split = (await splits()).find(s => s.userId === 'u2')!;
            await setSplitManually(db, T, u2Split.id, 5000, 'agreed for the crawlspace');

            await assign('u1');                                          // u2 leaves
            const { removed } = await syncSplitsForInspection(db, T, INSP);

            expect(removed).toBe(0);                                     // nothing rule-sourced to drop
            const rows = await splits();
            expect(rows.find(s => s.userId === 'u2')?.amountCents).toBe(5000);
            expect(await findOrphanSplits(db, T, INSP)).toContainEqual(
                expect.objectContaining({ reason: 'inspector_removed' }),
            );
        });

        it('removes an unpaid rule split when its inspector leaves', async () => {
            await setRule({ type: 'percent', value: 4000 });
            await assign('u1', ['u2']);
            await populateSplits(db, T, INSP);

            await assign('u1');
            const { removed } = await syncSplitsForInspection(db, T, INSP);

            expect(removed).toBe(1);
            expect((await splits()).map(s => s.userId)).toEqual(['u1']);
        });

        it('treats a deactivated line the same way', async () => {
            await setRule({ type: 'percent', value: 4000 });
            await assign('u1');
            await populateSplits(db, T, INSP);
            await setLine(LINE, { active: false });

            expect(await findOrphanSplits(db, T, INSP)).toContainEqual(
                expect.objectContaining({ reason: 'line_inactive' }),
            );
        });
    });
});
