import * as schema from '../../../server/lib/db/schema';
import type { TestDb } from './test-db';

export const TENANT = 't-vis';
export const OTHER_TENANT = 't-vis-other';
export const USERS = {
    owner: 'u-owner', manager: 'u-mgr',
    inspAll: 'u-all',          // inspector, viewAllInspections default (true)
    inspA: 'u-a',              // inspector, restricted
    inspB: 'u-b',              // inspector, restricted
    inspC: 'u-c',              // inspector, restricted, assigned to nothing
} as const;
export const INSP = {
    own: 'i-own',              // lead = inspA
    other: 'i-other',          // lead = inspB
    team: 'i-team',            // lead = inspB, helper = inspA
    unassigned: 'i-unassigned',// no roster rows, no inspector_id
    legacy: 'i-legacy',        // inspector_id = inspA, NO roster rows
    stale: 'i-stale',          // inspector_id = inspA, roster rows say inspB
    foreign: 'i-foreign',      // other tenant; its roster row names inspA's id
} as const;
/** What inspA may see, and what it may not. */
export const VISIBLE_TO_A = [INSP.own, INSP.team, INSP.legacy] as const;
export const HIDDEN_FROM_A = [INSP.other, INSP.unassigned, INSP.stale] as const;
/** Every inspection of the main tenant. */
export const ALL_OF_TENANT = [INSP.own, INSP.other, INSP.team, INSP.unassigned, INSP.legacy, INSP.stale] as const;

const base = (id: string, tenantId: string, inspectorId: string | null) => ({
    id, tenantId, propertyAddress: `${id} Main St`, date: new Date().toISOString().slice(0, 10),
    status: 'confirmed' as const, paymentStatus: 'unpaid' as const, price: 10000,
    paymentRequired: false, agreementRequired: false, createdAt: new Date(), inspectorId,
});

/**
 * The fixture as plain rows, with no database in sight, so a node-environment spec (better-sqlite3)
 * and a workerd spec (real D1) can insert exactly the same data and be compared on the same expectations.
 */
export function visibilityFixtureRows(now: Date = new Date()) {
    const mk = (id: string, role: 'owner' | 'manager' | 'inspector', overrides: Record<string, boolean> | null) =>
        ({ id, tenantId: TENANT, email: `${id}@example.test`, passwordHash: 'x', role, permissionOverrides: overrides, createdAt: now });
    const link = (inspectionId: string, userId: string, role: 'lead' | 'helper', tenantId = TENANT) =>
        ({ inspectionId, userId, tenantId, role, createdAt: now });
    return {
        tenants: [[TENANT, 'vis'], [OTHER_TENANT, 'vis-other']].map(([id, slug]) =>
            ({ id: id!, slug: slug!, status: 'active' as const, deploymentMode: 'shared' as const, tier: 'free' as const, createdAt: now })),
        users: [
            mk(USERS.owner, 'owner', null), mk(USERS.manager, 'manager', null), mk(USERS.inspAll, 'inspector', null),
            mk(USERS.inspA, 'inspector', { viewAllInspections: false }),
            mk(USERS.inspB, 'inspector', { viewAllInspections: false }),
            mk(USERS.inspC, 'inspector', { viewAllInspections: false }),
        ],
        inspections: [
            base(INSP.own, TENANT, USERS.inspA), base(INSP.other, TENANT, USERS.inspB), base(INSP.team, TENANT, USERS.inspB),
            base(INSP.unassigned, TENANT, null), base(INSP.legacy, TENANT, USERS.inspA), base(INSP.stale, TENANT, USERS.inspA),
            base(INSP.foreign, OTHER_TENANT, null),
        ],
        roster: [
            link(INSP.own, USERS.inspA, 'lead'), link(INSP.other, USERS.inspB, 'lead'),
            link(INSP.team, USERS.inspB, 'lead'), link(INSP.team, USERS.inspA, 'helper'),
            link(INSP.stale, USERS.inspB, 'lead'),
            link(INSP.foreign, USERS.inspA, 'lead', OTHER_TENANT),
        ],
    };
}

export async function seedVisibilityFixture(db: TestDb): Promise<void> {
    const rows = visibilityFixtureRows();
    await db.insert(schema.tenants).values(rows.tenants);
    await db.insert(schema.users).values(rows.users);
    await db.insert(schema.inspections).values(rows.inspections);
    await db.insert(schema.inspectionInspectors).values(rows.roster);
}
