/**
 * The purge reaches the Durable Objects, and refuses to call itself finished
 * when it could not.
 *
 * Two facts decide the design and both are asserted here rather than assumed:
 *
 *   1. `INSPECTION_DOC` is addressed by `${tenantId}:${reportId}` — the REPORT,
 *      not the inspection. So the purge can only name those objects if it
 *      collects the report ids BEFORE the cascade deletes the rows they come
 *      from. Collecting them afterwards yields an empty list and a purge that
 *      reports success having destroyed nothing.
 *   2. `TENANT_PRESENCE` is addressed by the bare tenant id, which needs no
 *      collection at all.
 *
 * `INSPECTION_PRESENCE` is deliberately not called: it holds no storage of its
 * own, and it is addressed by inspection id with no tenant component, so a
 * tenant purge could not enumerate its objects even if it did.
 *
 * Lives beside `tenant-purge.service.spec.ts` rather than in a new directory —
 * same service, same harness, and a reader looking for what the purge does
 * should find both in one place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService } from '../../../server/services/tenant-purge.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    DESTRUCTION_RECORD_GENERATION, STORES_MEASURED, isCertifiableAtCurrentScope,
} from '../../../server/lib/compliance/destruction-scope';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';
const REPORT_A = 'report-aaa';
const REPORT_B = 'report-bbb';

function makeR2() {
    return {
        list: vi.fn(async () => ({ objects: [], truncated: false, cursor: undefined })),
        delete: vi.fn(async () => {}),
    } as unknown as R2Bucket;
}
const makeKv = () => ({ delete: vi.fn(async () => {}) } as unknown as KVNamespace);

/**
 * A namespace stub that records the NAME each stub was derived from.
 *
 * Recording the name and not merely the call count is the point: a purge that
 * calls the right number of objects with the wrong names destroys nothing and
 * is indistinguishable from a working one by count alone.
 */
function stubNamespace(record: (name: string) => void, ok = true) {
    return {
        idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
        get: (id: DurableObjectId) => ({
            fetch: async () => {
                record((id as unknown as { name: string }).name);
                return ok
                    ? new Response(JSON.stringify({ purged: true }), { status: 200 })
                    : new Response('boom', { status: 500 });
            },
        }) as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace;
}

describe('TenantPurgeService — Durable Objects', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        for (const id of [TENANT, OTHER]) {
            await testDb.insert(schema.tenants).values({
                id, slug: `t-${id.slice(-3)}`, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
        // One inspection per tenant. Sharing one row across two tenants is not a
        // shape the product can produce, and it also collides with
        // `uq_reports_primary` — a partial unique index over inspection_id
        // where kind = 'primary'.
        await testDb.insert(schema.inspections).values([
            {
                id: 'i-1', tenantId: TENANT, propertyAddress: '1 St', date: '2026-06-01',
                status: 'requested', paymentStatus: 'unpaid', price: 0,
                agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            },
            {
                id: 'i-2', tenantId: OTHER, propertyAddress: '2 St', date: '2026-06-01',
                status: 'requested', paymentStatus: 'unpaid', price: 0,
                agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            },
        ]);
        await testDb.insert(schema.reports).values([
            // Two reports on ONE inspection — the primary and an ancillary — so
            // the count below cannot be satisfied by an implementation that
            // keyed the Durable Object on the inspection instead of the report.
            { id: REPORT_A, tenantId: TENANT, inspectionId: 'i-1', kind: 'primary', title: 'A', createdAt: new Date() },
            { id: REPORT_B, tenantId: TENANT, inspectionId: 'i-1', kind: 'ancillary', title: 'B', createdAt: new Date() },
            // Another tenant's report. If this name is ever purged the collection
            // is not tenant-scoped, which is a cross-tenant destruction.
            { id: 'report-other', tenantId: OTHER, inspectionId: 'i-2', kind: 'primary', title: 'C', createdAt: new Date() },
        ]);
    });

    it('collects report ids BEFORE the cascade and purges one DO per report', async () => {
        const calls: string[] = [];
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: stubNamespace((n) => calls.push(n)),
            TENANT_PRESENCE: stubNamespace((n) => calls.push(n)),
        });

        const out = await svc.purge(TENANT);

        expect(calls).toEqual([`${TENANT}:${REPORT_A}`, `${TENANT}:${REPORT_B}`, TENANT]);
        expect(out.durableObjects).toBe(3);
        expect(out.incompleteStores).toEqual([]);
    });

    it('never names another tenant\'s report', async () => {
        const calls: string[] = [];
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: stubNamespace((n) => calls.push(n)),
            TENANT_PRESENCE: stubNamespace((n) => calls.push(n)),
        });
        await svc.purge(TENANT);
        expect(calls.some((n) => n.includes('report-other'))).toBe(false);
        expect(calls.some((n) => n.startsWith(OTHER))).toBe(false);
    });

    it('marks the destruction incomplete when a DO purge fails, and does not report success', async () => {
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: stubNamespace(() => {}, false),
            TENANT_PRESENCE: stubNamespace(() => {}),
        });

        const out = await svc.purge(TENANT);

        expect(out.incompleteStores).toContain('durable_objects');
        // The two that failed are not counted as purged. Counting an attempt
        // would make the number in the destruction record a measure of effort.
        expect(out.durableObjects).toBe(1);
    });

    it('a rejected fetch is incomplete too, not merely a non-ok status', async () => {
        const throwing = {
            idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
            get: () => ({ fetch: async () => { throw new Error('unreachable'); } }) as unknown as DurableObjectStub,
        } as unknown as DurableObjectNamespace;
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: throwing, TENANT_PRESENCE: throwing,
        });

        const out = await svc.purge(TENANT);
        expect(out.incompleteStores).toContain('durable_objects');
        expect(out.durableObjects).toBe(0);
    });

    it('records the outcome on the ROW, not only in the return value', async () => {
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: stubNamespace(() => {}, false),
            TENANT_PRESENCE: stubNamespace(() => {}),
        });
        await svc.purge(TENANT);

        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        // A return value is read by one caller and then gone. The row is what an
        // SCC Clause 8.5 certification is read off years later.
        expect(rec?.recordVersion).toBe(DESTRUCTION_RECORD_GENERATION);
        expect(rec?.storesMeasured).toEqual([...STORES_MEASURED]);
        expect(rec?.storeResults?.['durable_objects']).toBe('incomplete');
        expect(rec?.storeResults?.['database']).toBe('complete');
        // The run DID finish, so the status axis still says so. The unverified
        // measurement lives in store_results, and certifiability is the question
        // that reads both.
        expect(rec?.status).toBe('completed');
        expect(isCertifiableAtCurrentScope({
            recordVersion: rec!.recordVersion,
            status: rec!.status,
            storesMeasured: rec!.storesMeasured,
            storeResults: rec!.storeResults,
        })).toBe(false);
    });

    it('a fully successful purge writes a certifiable record', async () => {
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: stubNamespace(() => {}),
            TENANT_PRESENCE: stubNamespace(() => {}),
        });
        await svc.purge(TENANT);

        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        expect(isCertifiableAtCurrentScope({
            recordVersion: rec!.recordVersion,
            status: rec!.status,
            storesMeasured: rec!.storesMeasured,
            storeResults: rec!.storeResults,
        })).toBe(true);
    });

    it('an unbound namespace is skipped without inventing a failure', async () => {
        // A deployment that never enabled collaborative editing has no
        // INSPECTION_DOC binding, so no such object was ever created and there
        // is nothing there to destroy. Reporting that as incomplete would make
        // every standalone purge cry wolf, and an alarm that always fires is
        // read as noise by the second week.
        const calls: string[] = [];
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            TENANT_PRESENCE: stubNamespace((n) => calls.push(n)),
        });

        const out = await svc.purge(TENANT);
        expect(calls).toEqual([TENANT]);
        expect(out.durableObjects).toBe(1);
        expect(out.incompleteStores).toEqual([]);
    });
});
