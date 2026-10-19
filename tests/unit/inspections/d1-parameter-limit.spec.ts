/**
 * D1 binds at most 100 parameters per statement; SQLite in Node accepts tens of thousands, so a
 * list of ids bound in one statement passes every in-memory test and fails in production once a
 * company is big enough. The binding below refuses what D1 would refuse, and each read that takes
 * an unbounded list of inspection ids is run over 250 of them.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { inArray } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { getInspectionRosters } from '../../../server/lib/inspection/roster';
import { anyInspectionStarted } from '../../../server/lib/inspection/inspection-started';
import { mayActOnContact } from '../../../server/lib/inspection/assignment-access';

const LIMIT = 100;

function limited(db: D1Database): D1Database {
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver) as unknown;
            if (prop !== 'prepare' || typeof value !== 'function') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => new Proxy(stmt, {
                get(s, key, r) {
                    const v = Reflect.get(s, key, r) as unknown;
                    if (key === 'bind') {
                        return (...args: unknown[]) => {
                            if (args.length > LIMIT) throw new Error(`D1_ERROR: too many SQL variables (${args.length} > ${LIMIT})`);
                            return wrap((v as (...a: unknown[]) => D1PreparedStatement).apply(s, args));
                        };
                    }
                    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
                },
            });
            return (sql: string) => wrap((value as (s: string) => D1PreparedStatement).call(target, sql));
        },
    }) as D1Database;
}

const N = 250;
const ids = Array.from({ length: N }, (_, i) => `66666666-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.inspections).values(ids.map((id) => ({
        id, tenantId: TENANT_ID, propertyAddress: `${id.slice(-3)} Limit Road`, date: '2026-12-01', status: 'scheduled', paymentStatus: 'unpaid',
        price: 0, agreementRequired: false, paymentRequired: false, inspectorId: OWNER_ID, createdAt: now,
    })) as never);
    await h.db.insert(schema.inspectionInspectors).values(ids.map((id) => ({ inspectionId: id, userId: OWNER_ID, tenantId: TENANT_ID, role: 'lead' as const, createdAt: now })) as never);
    await h.db.insert(schema.inspectionResults).values(ids.map((id, i) => ({
        id: `res-${i}`, tenantId: TENANT_ID, inspectionId: id, data: '{"a":1}', lastSyncedAt: now, createdAt: now,
    })) as never);
    return { h, db: drizzle(limited(h.env.DB as D1Database)) };
}

describe('reads over a long list of inspection ids stay under the D1 parameter limit', () => {
    it('the binding refuses what D1 refuses (control)', async () => {
        const { h, db } = await setup();
        try {
            const failure = await db.select({ id: schema.inspections.id }).from(schema.inspections).where(inArray(schema.inspections.id, ids)).all().then(() => null, (e: unknown) => e);
            // drizzle wraps the driver's error; the cause carries the refusal.
            expect(String((failure as { cause?: unknown } | null)?.cause ?? failure)).toMatch(/too many SQL variables/);
        } finally { h.close(); }
    });

    it('dashboard defect counts, with and without the snapshots already read', async () => {
        const { h } = await setup();
        try {
            const svc = new InspectionAnalyticsService(limited(h.env.DB as D1Database), undefined, undefined, undefined, undefined, {} as never);
            expect((await svc.getDefectStatsBatch(TENANT_ID, ids)).size).toBe(N);
            expect((await svc.getDefectStatsBatch(TENANT_ID, ids, new Map(ids.map((id) => [id, null])))).size).toBe(N);
        } finally { h.close(); }
    });

    it('inspection rosters', async () => {
        const { h, db } = await setup();
        try {
            expect((await getInspectionRosters(db as never, TENANT_ID, ids)).size).toBe(N);
        } finally { h.close(); }
    });

    it('whether any inspection in a bulk request has started', async () => {
        const { h, db } = await setup();
        try {
            // Every row has result keys, so the answer is true only if the results were really read for all of them.
            expect(await anyInspectionStarted(db as never, TENANT_ID, ids)).toBe(true);
            expect(await anyInspectionStarted(db as never, TENANT_ID, [])).toBe(false);
        } finally { h.close(); }
    });

    it('whether a manager may act on a contact seated on more than 100 inspections', async () => {
        const { h, db } = await setup();
        try {
            await h.db.insert(schema.contacts).values({ id: 'c-many', tenantId: TENANT_ID, type: 'agent', name: 'Busy Agent', email: 'busy@realty.example', createdAt: new Date() } as never);
            const profile = (await h.db.select({ id: schema.contactRoleProfiles.id }).from(schema.contactRoleProfiles).limit(1).get())!.id;
            await h.db.insert(schema.inspectionPeople).values(ids.map((id, i) => ({ id: `pp-${i}`, tenantId: TENANT_ID, inspectionId: id, contactId: 'c-many', roleProfileId: profile, createdAt: new Date() })) as never);
            const ctx = (userId: string, role: string) => ({
                get: (k: string) => ({ userRole: role, tenantId: TENANT_ID, user: { sub: userId } } as Record<string, unknown>)[k],
                env: { DB: limited(h.env.DB as D1Database) },
            });
            // The owner's seat is on the roster of the last chunk's inspections: found, not a limit error.
            expect(await mayActOnContact(ctx(OWNER_ID, 'manager') as never, 'c-many')).toBe(true);
            void db; void INSPECTOR_ID;
        } finally { h.close(); }
    });
});
