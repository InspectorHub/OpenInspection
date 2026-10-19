/**
 * A dashboard worth comparing: every bucket, every decoration the dashboard
 * attaches, a second company whose rows must never show up, and a pinned clock
 * so two runs of the same code produce the same bytes.
 *
 * The data is built to exercise each lookup `getDashboardBuckets` makes: defect
 * counts (template snapshot + results), agent names, effective price (invoice,
 * service lines, cached column), signed agreements, overdue invoices, inspector
 * names, sibling counts and the concierge count. Rows of the OTHER company point
 * at this company's inspection ids on purpose: a lookup that forgets its tenant
 * filter changes an answer here instead of being invisible.
 */
import * as schema from '../../../server/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { TENANT_ID, OWNER_ID, INSPECTOR_ID, type Harness } from './tenant-email-harness';

export const FIXED_NOW = new Date('2026-10-19T12:00:00.000Z');
export const OTHER_TENANT_ID = '99999999-0000-4000-8000-000000000009';
export const OTHER_OWNER_ID = '88888888-0000-4000-8000-000000000009';
export const MANAGER_ID = '22222222-0000-4000-8000-000000000003';

export const inspectionId = (n: number) => `55555555-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = inspectionId;
const HOUR = 3600 * 1000;

const SNAPSHOT = {
    sections: [{ id: 's1', items: [
        { id: 'i1', tabs: { defects: [
            { id: 'd1', category: 'safety', default: true },
            { id: 'd2', category: 'maintenance', default: false },
            { id: 'd3', category: 'recommendation', default: true },
        ] } },
        { id: 'i2', tabs: { defects: [{ id: 'd4', category: 'maintenance', default: true }] } },
    ] }],
};
const RESULTS = { i1: { tabs: { defects: [{ cannedId: 'd2', included: true, category: 'safety' }, { cannedId: 'd3', included: false }] } } };

interface Spec {
    n: number; date: string; status: string; reportStatus?: string; ageHours?: number;
    inspectorId?: string | null; concierge?: string; request?: string; price?: number; rich?: boolean;
}

function specs(): Spec[] {
    const out: Spec[] = [
        { n: 1, date: '2026-10-19', status: 'scheduled', ageHours: 1, inspectorId: OWNER_ID, rich: true, price: 9000 },
        { n: 2, date: '2026-10-19', status: 'confirmed', ageHours: 1, inspectorId: INSPECTOR_ID, rich: true, request: 'req-a' },
        { n: 3, date: '2026-10-19', status: 'cancelled', ageHours: 2, inspectorId: OWNER_ID },
        { n: 4, date: '2026-10-22', status: 'scheduled', ageHours: 1, inspectorId: INSPECTOR_ID, rich: true, request: 'req-a' },
        { n: 5, date: '2026-10-25', status: 'scheduled', ageHours: 1, inspectorId: OWNER_ID, concierge: 'awaiting_inspector' },
        { n: 6, date: '2026-10-25', status: 'cancelled', ageHours: 1, inspectorId: INSPECTOR_ID },
        { n: 7, date: '2026-10-10', status: 'completed', reportStatus: 'published', ageHours: 200, inspectorId: INSPECTOR_ID, rich: true },
        { n: 8, date: '2026-10-09', status: 'completed', reportStatus: 'published', ageHours: 300, inspectorId: OWNER_ID },
        { n: 9, date: '2026-10-08', status: 'completed', reportStatus: 'in_progress', ageHours: 400, inspectorId: INSPECTOR_ID },
        { n: 10, date: '2026-10-07', status: 'completed', reportStatus: 'submitted', ageHours: 5, inspectorId: OWNER_ID },
        { n: 11, date: '2026-09-01', status: 'cancelled', ageHours: 24 * 60, inspectorId: OWNER_ID },
        { n: 12, date: '2026-10-17', status: 'cancelled', ageHours: 24 * 3, inspectorId: INSPECTOR_ID },
        { n: 13, date: '2026-10-20', status: 'scheduled', ageHours: 1, inspectorId: null, concierge: 'awaiting_inspector' },
    ];
    // 55 inspections beyond a week out: more than the 50 the bucket shows.
    for (let k = 0; k < 55; k++) {
        const day = 1 + (k % 28);
        out.push({ n: 100 + k, date: `2026-11-${String(day).padStart(2, '0')}`, status: 'scheduled', ageHours: 1 + (k % 5) * 40, inspectorId: k % 3 === 0 ? INSPECTOR_ID : OWNER_ID });
    }
    return out;
}

/** Everything the dashboard reads, for the main company and (optionally) a second one. */
export async function seedDashboard(h: Harness, options: { withOtherCompany?: boolean } = {}): Promise<void> {
    const db = h.db;
    const created = (hours: number) => new Date(FIXED_NOW.getTime() - hours * HOUR);

    await db.insert(schema.users).values({
        id: MANAGER_ID, tenantId: TENANT_ID, email: 'mgr@harbor-light.test', passwordHash: 'h', role: 'manager', name: 'Mona Manager', slug: 'mona', createdAt: created(900),
    } as never);
    await db.update(schema.users).set({ slug: 'olive' } as never).where(eq(schema.users.id, OWNER_ID));
    // The inspector sees only what is assigned to them, and not what inspections cost.
    await db.update(schema.users).set({ slug: 'ivan', permissionOverrides: { viewAllInspections: false, inspectionFees: false } } as never)
        .where(eq(schema.users.id, INSPECTOR_ID));
    await db.insert(schema.contacts).values([
        { id: 'c-list', tenantId: TENANT_ID, type: 'agent', name: 'Lisa Listing', email: 'lisa@realty.example', createdAt: created(900) },
        { id: 'c-buy', tenantId: TENANT_ID, type: 'agent', name: 'Bob Buyer', email: 'bob@realty.example', createdAt: created(900) },
    ] as never);
    const profile = async (key: string) =>
        (await db.select({ id: schema.contactRoleProfiles.id }).from(schema.contactRoleProfiles)
            .where(and(eq(schema.contactRoleProfiles.tenantId, TENANT_ID), eq(schema.contactRoleProfiles.key, key))).get())!.id;
    const listing = await profile('listing_agent');
    const buyer = await profile('buyer_agent');

    await db.insert(schema.inspectionRequests).values({
        id: 'req-a', tenantId: TENANT_ID, clientName: 'Pat Client', propertyAddress: '4 Shared St', scheduledAt: created(-48), createdAt: created(10), updatedAt: created(10),
    } as never);

    const list = specs();
    await db.insert(schema.inspections).values(list.map((s) => ({
        id: id(s.n), tenantId: TENANT_ID, propertyAddress: `${s.n} Fixture Road`, date: s.date, status: s.status,
        paymentStatus: 'unpaid', price: s.price ?? 0, agreementRequired: false, paymentRequired: false,
        reportStatus: s.reportStatus ?? 'in_progress', inspectorId: s.inspectorId ?? null,
        conciergeStatus: s.concierge ?? null, requestId: s.request ?? null,
        templateSnapshot: s.rich ? SNAPSHOT : null, createdAt: created(s.ageHours ?? 1),
    })) as never);
    // Roster rows: inspection 2 has a roster whose lead is the inspector; 5 gives the inspector a helper seat.
    await db.insert(schema.inspectionInspectors).values([
        { inspectionId: id(2), userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: created(1) },
        { inspectionId: id(5), userId: OWNER_ID, tenantId: TENANT_ID, role: 'lead', createdAt: created(1) },
        { inspectionId: id(5), userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'helper', createdAt: created(1) },
    ] as never);
    await db.insert(schema.inspectionResults).values([1, 2, 4, 7].map((n) => ({
        id: `res-${n}`, tenantId: TENANT_ID, inspectionId: id(n), data: n === 1 ? '{}' : RESULTS, lastSyncedAt: created(1), createdAt: created(1),
    })) as never);
    await db.insert(schema.inspectionPeople).values([
        { id: 'p1', tenantId: TENANT_ID, inspectionId: id(1), contactId: 'c-list', roleProfileId: listing, createdAt: created(1) },
        { id: 'p2', tenantId: TENANT_ID, inspectionId: id(2), contactId: 'c-buy', roleProfileId: buyer, createdAt: created(1) },
        { id: 'p3', tenantId: TENANT_ID, inspectionId: id(4), contactId: 'c-buy', roleProfileId: buyer, createdAt: created(1) },
        { id: 'p4', tenantId: TENANT_ID, inspectionId: id(4), contactId: 'c-list', roleProfileId: listing, createdAt: created(1) },
    ] as never);

    await db.insert(schema.invoices).values([
        // the earliest non-voided invoice wins; the later one must not
        { id: 'inv-1a', tenantId: TENANT_ID, inspectionId: id(1), amountCents: 45000, lineItems: [], dueDate: '2026-10-01', createdAt: created(100) },
        { id: 'inv-1b', tenantId: TENANT_ID, inspectionId: id(1), amountCents: 1000, lineItems: [], dueDate: '2026-10-01', createdAt: created(50) },
        // unpaid and past its due date by more than the threshold: overdue
        { id: 'inv-2', tenantId: TENANT_ID, inspectionId: id(2), amountCents: 38000, lineItems: [], dueDate: '2026-10-05', createdAt: created(60) },
        // paid and voided ones are never overdue; a voided one is not a price either
        { id: 'inv-4', tenantId: TENANT_ID, inspectionId: id(4), amountCents: 5000, lineItems: [], dueDate: '2026-10-05', paidAt: created(10), createdAt: created(30) },
        { id: 'inv-7', tenantId: TENANT_ID, inspectionId: id(7), amountCents: 99900, lineItems: [], dueDate: '2026-10-05', voidedAt: created(5), createdAt: created(30) },
    ] as never);
    await db.insert(schema.services).values({ id: 'svc-cat', tenantId: TENANT_ID, name: 'Catalog', price: 0, createdAt: created(900) } as never);
    await db.insert(schema.inspectionServices).values([
        { id: 'is1', tenantId: TENANT_ID, inspectionId: id(7), serviceId: 'svc-cat', nameSnapshot: 'A', priceSnapshot: 20000, priceOverride: 12500 },
        { id: 'is2', tenantId: TENANT_ID, inspectionId: id(7), serviceId: 'svc-cat', nameSnapshot: 'B', priceSnapshot: 5000, priceOverride: null },
        { id: 'is3', tenantId: TENANT_ID, inspectionId: id(8), serviceId: 'svc-cat', nameSnapshot: 'C', priceSnapshot: 7000, priceOverride: null, active: false },
        { id: 'is4', tenantId: TENANT_ID, inspectionId: id(8), serviceId: 'svc-cat', nameSnapshot: 'D', priceSnapshot: 8000, priceOverride: null },
    ] as never);
    await db.insert(schema.agreements).values({ id: 'agr-tpl', tenantId: TENANT_ID, name: 'Tpl', content: 'body', createdAt: created(900) } as never);
    await db.insert(schema.agreementRequests).values([1, 2, 4, 5, 9].map((n) => ({
        id: `ar-${n}`, tenantId: TENANT_ID, inspectionId: id(n), agreementId: 'agr-tpl', clientEmail: 'c@example.com', clientName: 'Client',
        tokenHash: `H-${n}`, status: n === 9 ? 'sent' : 'signed', signedAt: created(2), createdAt: created(3),
    })) as never);

    if (!options.withOtherCompany) return;

    await db.insert(schema.tenants).values({ id: OTHER_TENANT_ID, slug: 'other-co', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: created(900) } as never);
    await db.insert(schema.users).values({ id: OTHER_OWNER_ID, tenantId: OTHER_TENANT_ID, email: 'o@other.test', passwordHash: 'h', role: 'owner', name: 'Other Owner', createdAt: created(900) } as never);
    await db.insert(schema.contacts).values({ id: 'c-other', tenantId: OTHER_TENANT_ID, type: 'agent', name: 'Foreign Agent', email: 'f@other.test', createdAt: created(900) } as never);
    // The other company's own inspections, today and in the later bucket.
    await db.insert(schema.inspections).values([
        { id: id(900), tenantId: OTHER_TENANT_ID, propertyAddress: 'Foreign Today', date: '2026-10-19', status: 'scheduled', paymentStatus: 'unpaid', price: 1, agreementRequired: false, paymentRequired: false, inspectorId: OTHER_OWNER_ID, createdAt: created(1) },
        { id: id(901), tenantId: OTHER_TENANT_ID, propertyAddress: 'Foreign Later', date: '2026-12-01', status: 'scheduled', paymentStatus: 'unpaid', price: 1, agreementRequired: false, paymentRequired: false, inspectorId: OTHER_OWNER_ID, createdAt: created(1) },
    ] as never);
    // Rows that name THIS company's inspections but belong to the other one. Each would change a
    // price, a defect count, an agent name, a signed flag or an overdue flag if its lookup lost its tenant filter.
    await db.insert(schema.invoices).values([
        { id: 'x-inv-1', tenantId: OTHER_TENANT_ID, inspectionId: id(1), amountCents: 7, lineItems: [], dueDate: '2026-01-01', createdAt: created(900) },
        { id: 'x-inv-5', tenantId: OTHER_TENANT_ID, inspectionId: id(5), amountCents: 7, lineItems: [], dueDate: '2026-01-01', createdAt: created(900) },
    ] as never);
    await db.insert(schema.inspectionServices).values({ id: 'x-is', tenantId: OTHER_TENANT_ID, inspectionId: id(6), serviceId: 'svc-cat', nameSnapshot: 'X', priceSnapshot: 12345, priceOverride: null } as never);
    await db.insert(schema.inspectionResults).values({ id: 'x-res', tenantId: OTHER_TENANT_ID, inspectionId: id(3), data: RESULTS, lastSyncedAt: created(1), createdAt: created(1) } as never);
    await db.insert(schema.inspectionPeople).values({ id: 'x-p', tenantId: OTHER_TENANT_ID, inspectionId: id(5), contactId: 'c-other', roleProfileId: listing, createdAt: created(1) } as never);
    await db.insert(schema.agreementRequests).values([3, 7, 8, 100].map((n) => ({
        id: `x-ar-${n}`, tenantId: OTHER_TENANT_ID, inspectionId: id(n), agreementId: 'agr-tpl', clientEmail: 'x@example.com', clientName: 'X',
        tokenHash: `XH-${n}`, status: 'signed', signedAt: created(2), createdAt: created(3),
    })) as never);
}
