/**
 * The visibility predicate against REAL D1 (workerd), not better-sqlite3.
 *
 * The predicate is a correlated sub-select over `inspections` and `inspection_inspectors`, plus a fallback to
 * the legacy `inspector_id` column when an inspection has no roster rows. Node-side specs pin the rule on
 * better-sqlite3; this one replays the real migrations into D1 and asserts the same sets from the same rows
 * (`visibilityFixtureRows`), so a difference in how D1 plans a correlated NOT EXISTS, or in its bind-parameter
 * ceiling, shows up here rather than in production.
 *
 * Both numbers are printed and a zero is a failure: an empty fixture would make every "does not see" check true.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/lib/db/schema';
import {
    ALL_INSPECTIONS, visibleInspectionsCondition, visibleInspectionIds, assertInspectionVisible, filterVisibleInspectionIds,
    type InspectionScope,
} from '../../server/lib/inspection/visibility';
import {
    visibilityFixtureRows, TENANT, OTHER_TENANT, USERS, INSP, VISIBLE_TO_A, ALL_OF_TENANT,
} from '../unit/helpers/visibility-fixture';
import { applyMigrations } from './migration-replay';

const b = env as unknown as { DB: D1Database };
const migrationSql = import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const db = () => drizzle(b.DB);
const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

async function idsFor(scope: InspectionScope, tenant = TENANT): Promise<string[]> {
    const rows = await db().select({ id: schema.inspections.id }).from(schema.inspections)
        .where(and(eq(schema.inspections.tenantId, tenant), visibleInspectionsCondition(db(), scope, tenant))).all();
    return rows.map((r) => r.id).sort();
}

describe('visibility predicate on real D1', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        const rows = visibilityFixtureRows();
        const d = db();
        // One row per statement: an inspection row alone binds dozens of variables and D1 caps a statement at 100.
        for (const r of rows.tenants) await d.insert(schema.tenants).values(r);
        for (const r of rows.users) await d.insert(schema.users).values(r);
        for (const r of rows.inspections) await d.insert(schema.inspections).values(r);
        for (const r of rows.roster) await d.insert(schema.inspectionInspectors).values(r);
    });

    it('prints and checks both sides: the fixture is loaded and the restricted set is non-empty', async () => {
        const all = await idsFor(ALL_INSPECTIONS);
        const mine = await idsFor(A);
        console.log(`[gate] visibility predicate (D1): all=${all.length} visibleToA=${mine.length}`);
        expect(all.length).toBeGreaterThan(0);
        expect(mine.length).toBeGreaterThan(0);
    });
    it('lead, helper and legacy-column assignments are visible; others, unassigned and stale are not', async () => {
        expect(await idsFor(A)).toEqual([...VISIBLE_TO_A].sort());
    });
    it('the roster is the authority: the stale column names inspA, the roster names inspB', async () => {
        expect(await idsFor({ kind: 'assigned', userId: USERS.inspB })).toEqual([INSP.other, INSP.stale, INSP.team].sort());
        expect(await idsFor(A)).not.toContain(INSP.stale);
    });
    it('an inspector assigned to nothing sees nothing; the all-scope sees the whole company', async () => {
        expect(await idsFor({ kind: 'assigned', userId: USERS.inspC })).toEqual([]);
        expect(await idsFor(ALL_INSPECTIONS)).toEqual([...ALL_OF_TENANT].sort());
    });
    it('never crosses companies: a roster row in another company does not make that inspection visible here', async () => {
        expect(await idsFor(A)).not.toContain(INSP.foreign);
        expect(await idsFor(ALL_INSPECTIONS, OTHER_TENANT)).toEqual([INSP.foreign]);
        // The other company's own query for the same person sees its own inspection through its own roster row.
        expect(await idsFor(A, OTHER_TENANT)).toEqual([INSP.foreign]);
    });
    it('the sub-select form agrees with the condition form', async () => {
        const sub = visibleInspectionIds(db(), A, TENANT)!;
        const rows = await db().select({ id: schema.inspections.id }).from(schema.inspections)
            .where(and(eq(schema.inspections.tenantId, TENANT), inArray(schema.inspections.id, sub))).all();
        expect(rows.map((r) => r.id).sort()).toEqual([...VISIBLE_TO_A].sort());
    });
    it('assertInspectionVisible: 404 for a hidden id, silent for a visible, missing or foreign id', async () => {
        await expect(assertInspectionVisible(db(), A, TENANT, INSP.other)).rejects.toMatchObject({ status: 404 });
        await expect(assertInspectionVisible(db(), A, TENANT, INSP.own)).resolves.toBeUndefined();
        await expect(assertInspectionVisible(db(), A, TENANT, 'no-such-id')).resolves.toBeUndefined();
        await expect(assertInspectionVisible(db(), A, TENANT, INSP.foreign)).resolves.toBeUndefined();
    });
    it('filterVisibleInspectionIds batches under D1\'s bind-parameter ceiling', async () => {
        const ids = [INSP.own, INSP.other, ...Array.from({ length: 230 }, (_, i) => `x-${i}`), INSP.legacy];
        const kept = await filterVisibleInspectionIds(db(), A, TENANT, ids);
        expect([...kept].sort()).toEqual([INSP.legacy, INSP.own].sort());
    });
});
