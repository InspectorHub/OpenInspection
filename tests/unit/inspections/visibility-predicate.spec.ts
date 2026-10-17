import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { seedVisibilityFixture, TENANT, OTHER_TENANT, USERS, INSP, VISIBLE_TO_A, HIDDEN_FROM_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';
import {
    ALL_INSPECTIONS, visibleInspectionsCondition, visibleInspectionIds, assertInspectionVisible, filterVisibleInspectionIds,
    type InspectionScope,
} from '../../../server/lib/inspection/visibility';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('visibility predicate', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
    });
    const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };
    const idsFor = async (scope: InspectionScope, tenant = TENANT) => {
        const cond = visibleInspectionsCondition(asD1Db(db), scope, tenant);
        const rows = await db.select({ id: schema.inspections.id }).from(schema.inspections)
            .where(and(eq(schema.inspections.tenantId, tenant), cond)).all();
        return rows.map(r => r.id).sort();
    };

    it('lead, helper and legacy-column assignments are visible; others, unassigned and stale are not', async () => {
        const seen = await idsFor(A);
        expect(seen).toEqual([...VISIBLE_TO_A].sort());
        for (const hidden of HIDDEN_FROM_A) expect(seen).not.toContain(hidden);
    });
    it('the other inspector sees their own set (positive control for the stale row)', async () => {
        expect(await idsFor({ kind: 'assigned', userId: USERS.inspB })).toEqual([INSP.other, INSP.stale, INSP.team].sort());
    });
    it('an inspector assigned to nothing sees nothing', async () => {
        expect(await idsFor({ kind: 'assigned', userId: USERS.inspC })).toEqual([]);
    });
    it("the 'all' scope adds no condition and returns every inspection of the tenant", async () => {
        expect(visibleInspectionsCondition(asD1Db(db), ALL_INSPECTIONS, TENANT)).toBeUndefined();
        expect(await idsFor(ALL_INSPECTIONS)).toEqual([...ALL_OF_TENANT].sort());
    });
    it('never crosses tenants: a roster row in another company does not make that inspection visible here', async () => {
        const rows = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP.foreign)).all();
        expect(rows).toHaveLength(1);
        expect(await idsFor(A)).not.toContain(INSP.foreign);
        // and from the other company, the same user id sees nothing of the main company
        expect(await idsFor(A, OTHER_TENANT)).toEqual([INSP.foreign]);
    });
    it('assertInspectionVisible: 404 for a hidden id, silent for a visible id, silent for a missing id', async () => {
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.other)).rejects.toMatchObject({ status: 404 });
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.unassigned)).rejects.toMatchObject({ status: 404 });
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.stale)).rejects.toMatchObject({ status: 404 });
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.own)).resolves.toBeUndefined();
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.team)).resolves.toBeUndefined();
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.legacy)).resolves.toBeUndefined();
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, 'no-such-id')).resolves.toBeUndefined();
        await expect(assertInspectionVisible(asD1Db(db), A, TENANT, INSP.foreign)).resolves.toBeUndefined(); // other company == absent
        await expect(assertInspectionVisible(asD1Db(db), ALL_INSPECTIONS, TENANT, INSP.other)).resolves.toBeUndefined();
    });
    it('filterVisibleInspectionIds batches past the bind-parameter ceiling', async () => {
        const ids = [INSP.own, INSP.other, ...Array.from({ length: 130 }, (_, i) => `x-${i}`)];
        const set = await filterVisibleInspectionIds(asD1Db(db), A, TENANT, ids);
        expect([...set]).toEqual([INSP.own]);
    });
    it('visibleInspectionIds is the same set as the condition, for tables keyed by an inspection id', async () => {
        const sub = visibleInspectionIds(asD1Db(db), A, TENANT);
        expect(sub).toBeDefined();
        const rows = await db.select({ id: schema.inspectionInspectors.inspectionId }).from(schema.inspectionInspectors)
            .where(inArray(schema.inspectionInspectors.inspectionId, sub!)).all();
        const seen = [...new Set(rows.map(r => r.id))].sort();
        // link rows exist for own, other, team, stale (legacy and unassigned have none); of those A sees own and team
        expect(seen).toEqual([INSP.own, INSP.team].sort());
        expect(visibleInspectionIds(asD1Db(db), ALL_INSPECTIONS, TENANT)).toBeUndefined();
    });
});
