/**
 * An incomplete destruction tells the controller, while there is still an
 * address to tell.
 *
 * The ordering is the whole problem. The cascade deletes `users`, so by the
 * time we know a store refused to purge there is nobody left to address. The
 * owner's email is therefore resolved in the same pre-cascade block as the KV
 * keys and the report ids — and then used, and then dropped.
 *
 * WHAT THE ROW KEEPS, and what it does not. Round 22 requires notification
 * without undue delay after the failure is known. It does not require this
 * table to retain the address. `tenant_destruction_records` survives the tenant
 * by three years, and the retention manifest sets that period on the stated
 * ground that the row is non-personal — tenant id, slug and counts. Writing the
 * owner's email onto it would make the destruction record hold an identifier of
 * the very party it certifies we erased, and would falsify the reason the
 * three-year window rests on. So the row records THAT the controller was
 * notified and WHEN; who they were is answerable from the slug and the account
 * record on the portal side, which is where the customer relationship lives.
 *
 * The wording is mechanical on purpose. A failure to finish a deletion is not a
 * security incident, and dressing it as one would misinform the recipient about
 * what happened and what they need to do.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService } from '../../../server/services/tenant-purge.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

const makeR2 = () => ({
    list: vi.fn(async () => ({ objects: [], truncated: false, cursor: undefined })),
    delete: vi.fn(async () => {}),
} as unknown as R2Bucket);
const makeKv = () => ({ delete: vi.fn(async () => {}) } as unknown as KVNamespace);

function namespace(ok: boolean) {
    return {
        idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
        get: () => ({
            fetch: async () => new Response(ok ? '{"purged":true}' : 'boom', { status: ok ? 200 : 500 }),
        }) as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace;
}

function makeNotifier() {
    const sent: Array<{ to: string; stores: string[]; body: string }> = [];
    return {
        sent,
        notifier: {
            async sendDestructionIncompleteNotice(
                to: string, d: { destroyedAt: Date; stores: string[]; body: string },
            ) { sent.push({ to, stores: d.stores, body: d.body }); },
        },
    };
}

describe('destruction — incomplete notification', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values([
            // A non-owner first, so a lookup that takes the first user rather
            // than the owner picks the wrong one.
            { id: 'u-staff', tenantId: TENANT, email: 'staff@example.com', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
            { id: 'u-owner', tenantId: TENANT, email: 'owner@example.com', passwordHash: 'x', role: 'owner', createdAt: new Date() },
        ]);
    });

    it('resolves the owner BEFORE the cascade, so an incomplete purge still has an addressee', async () => {
        const { sent, notifier } = makeNotifier();
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: namespace(false), TENANT_PRESENCE: namespace(false),
        }, notifier);

        await svc.purge(TENANT);

        expect(sent).toHaveLength(1);
        expect(sent[0]!.to).toBe('owner@example.com');
        expect(sent[0]!.stores).toEqual(['durable_objects']);
        expect(sent[0]!.body).toContain('did not complete for the following stores: durable_objects');
        // Mechanical, not alarming. A deletion that did not finish is not a
        // security incident and must not read as one.
        expect(sent[0]!.body).not.toMatch(/breach|incident|security/i);
    });

    it('records that the controller was notified, and not who they are', async () => {
        const { notifier } = makeNotifier();
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: namespace(false), TENANT_PRESENCE: namespace(false),
        }, notifier);

        await svc.purge(TENANT);

        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        expect(rec?.incompleteNotifiedAt).toBeInstanceOf(Date);
        // The row must stay non-personal — that is the stated ground for its
        // three-year window. Any column holding the address would break it.
        expect(JSON.stringify(rec)).not.toContain('owner@example.com');
    });

    it('sends nothing when every store completed', async () => {
        const { sent, notifier } = makeNotifier();
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: namespace(true), TENANT_PRESENCE: namespace(true),
        }, notifier);

        await svc.purge(TENANT);

        expect(sent).toHaveLength(0);
        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        expect(rec?.incompleteNotifiedAt).toBeNull();
    });

    it('a failed send leaves the timestamp null rather than claiming a notice', async () => {
        // The absence IS the alert, exactly as `status` stuck at 'started' is.
        // Writing the timestamp before the send, or regardless of it, would
        // produce a record asserting a notification nobody received.
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: namespace(false), TENANT_PRESENCE: namespace(false),
        }, {
            async sendDestructionIncompleteNotice() { throw new Error('provider down'); },
        });

        // The purge itself must still finish: the rows are already gone.
        const out = await svc.purge(TENANT);
        expect(out.incompleteStores).toContain('durable_objects');

        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        expect(rec?.incompleteNotifiedAt).toBeNull();
    });

    it('with no notifier wired, the purge still completes and records no notice', async () => {
        const svc = new TenantPurgeService({} as D1Database, makeR2(), makeKv(), {
            INSPECTION_DOC: namespace(false), TENANT_PRESENCE: namespace(false),
        });
        const out = await svc.purge(TENANT);
        expect(out.incompleteStores).toContain('durable_objects');
        const rec = await testDb.select().from(schema.tenantDestructionRecords).get();
        expect(rec?.incompleteNotifiedAt).toBeNull();
    });
});
