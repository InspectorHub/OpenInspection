/**
 * Matching a contact to a QuickBooks customer is the one thing that fixes the
 * invoices that failed for want of one. These specs pin what the re-sync that
 * follows may and may not touch:
 *
 *  - only invoices of THIS company and THIS contact that failed BECAUSE the
 *    contact had no QuickBooks customer -- not one that failed for another
 *    reason, not one already on the books, not a void one;
 *  - at most `limit` per call, oldest first, so one match cannot turn into an
 *    unbounded burst of calls on a plan with a small per-request allowance;
 *  - a second match changes nothing: the first one's invoices are on the books
 *    and are not pushed again;
 *  - the route hands the work to the request's execution context and answers
 *    without waiting for it, and a re-sync that fails does not undo the match.
 *
 * Each negative assertion is paired with a positive control in the same test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';

import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';
import { withCustomerSync } from '../../../server/services/qbo/customer-sync';
import { noCustomerFailureMessage } from '../../../server/services/qbo/invoice-payload';
import { resyncInvoicesForContact, RESYNC_INVOICE_LIMIT } from '../../../server/services/qbo/resync';
import qboRoutes from '../../../server/api/qbo';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const CONTACT = 'contact-aaaa-0000-0000-000000000001';
const OTHER_CONTACT = 'contact-bbbb-0000-0000-000000000002';
const FOREIGN_CONTACT = 'contact-cccc-0000-0000-000000000003';
const REALM = 'realm-1';
const T0 = new Date('2026-03-01T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date(Date.now() + 24 * 3_600_000);

class TestQbo extends withInvoiceSync(withCustomerSync(QBOServiceBase)) {}

let db: BetterSQLite3Database<typeof schema>;
let qbo: TestQbo;
let posts: Array<{ DocNumber?: string; CustomerRef?: { value: string } }>;
let nextInvoiceId: number;
/** Answers the next invoice POST with a QuickBooks validation fault. */
let failNextPosts: number;

function installFetch() {
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        if (failNextPosts > 0) {
            failNextPosts -= 1;
            return new Response(JSON.stringify({
                Fault: { Error: [{ code: '6000', Message: 'Business Validation Error', Detail: 'secret-internal-detail' }], type: 'ValidationFault' },
            }), { status: 400 });
        }
        nextInvoiceId += 1;
        return new Response(JSON.stringify({ Invoice: { Id: `QBO-INV-${nextInvoiceId}`, SyncToken: '0' } }), { status: 200 });
    }));
}

interface SeedInvoice {
    id: string; tenantId?: string; contactId?: string; createdAt?: Date; voidedAt?: Date;
    syncStatus?: 'synced' | 'failed' | null; errorMsg?: string; onTheBooks?: boolean;
    paidAt?: Date; partialPaidAt?: Date;
}

async function seedInvoice(o: SeedInvoice) {
    const tenantId = o.tenantId ?? TENANT;
    const contactId = o.contactId ?? CONTACT;
    await db.insert(schema.invoices).values({
        id: o.id, tenantId, contactId, amountCents: 45000, createdAt: o.createdAt ?? T0,
        lineItems: [{ description: 'Full home inspection', amountCents: 45000 }],
        voidedAt: o.voidedAt, paidAt: o.paidAt, partialPaidAt: o.partialPaidAt, qboSyncStatus: o.syncStatus === undefined ? 'failed' : o.syncStatus,
    } as never);
    if ((o.syncStatus ?? 'failed') === 'failed') {
        await db.insert(schema.qboSyncErrors).values({
            id: `err-${o.id}`, tenantId, oiType: 'invoice', oiId: o.id, errorCode: 'SYNC_ERROR',
            errorMsg: o.errorMsg ?? noCustomerFailureMessage(contactId),
            retries: 0, resolved: false, createdAt: T0, updatedAt: T0,
        });
    }
    if (o.onTheBooks) {
        await db.insert(schema.qboEntityMap).values({
            id: `map-${o.id}`, tenantId, oiType: 'invoice', oiId: o.id,
            qboType: 'Invoice', qboId: `QBO-EXISTING-${o.id}`, qboSyncToken: '3', syncedAt: T0,
        });
    }
}

const invoiceRow = (id: string) => db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
const errorRow = (id: string) => db.select().from(schema.qboSyncErrors).where(eq(schema.qboSyncErrors.oiId, id)).get();
const bookRows = (tenantId: string) => db.select().from(schema.qboEntityMap)
    .where(and(eq(schema.qboEntityMap.tenantId, tenantId), eq(schema.qboEntityMap.oiType, 'invoice'))).all();

beforeEach(async () => {
    posts = [];
    nextInvoiceId = 0;
    failNextPosts = 0;
    installFetch();

    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    qbo = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa', 'sandbox');

    for (const id of [TENANT, OTHER_TENANT]) {
        await db.insert(schema.tenants).values({
            id, slug: `t-${id.slice(-1)}`, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: T0,
        });
        await db.insert(schema.qboConnections).values({
            tenantId: id, realmId: `${REALM}-${id.slice(-1)}`, accessToken: 'enc:access', refreshToken: 'enc:refresh',
            tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
            defaultItemId: 'ITEM-7', createdAt: T0,
        });
    }
    for (const [id, tenantId] of [[CONTACT, TENANT], [OTHER_CONTACT, TENANT], [FOREIGN_CONTACT, OTHER_TENANT]] as const) {
        await db.insert(schema.contacts).values({ id, tenantId, type: 'client', name: `Name ${id}`, createdAt: T0 } as never);
        // The match that has just been made: each contact has a QuickBooks customer.
        await db.insert(schema.qboEntityMap).values({
            id: `map-${id}`, tenantId, oiType: 'contact', oiId: id,
            qboType: 'Customer', qboId: `QBO-CUST-${id.slice(-1)}`, qboSyncToken: '0', syncedAt: T0,
        });
    }
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('resyncInvoicesForContact', () => {
    it('pushes the contact\'s failed invoices and leaves the one already on the books alone', async () => {
        await seedInvoice({ id: 'inv-1', createdAt: new Date('2026-03-01T10:00:00Z') });
        await seedInvoice({ id: 'inv-2', createdAt: new Date('2026-03-02T10:00:00Z') });
        await seedInvoice({ id: 'inv-done', syncStatus: 'synced', onTheBooks: true });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0, remaining: 0 });
        expect(posts).toHaveLength(2);
        expect((await invoiceRow('inv-1'))?.qboSyncStatus).toBe('synced');
        expect((await invoiceRow('inv-2'))?.qboSyncStatus).toBe('synced');
        // Positive control above; the negative: the finished one was not pushed again.
        expect(bookRows(TENANT).map((r) => r.oiId).sort()).toEqual(['inv-1', 'inv-2', 'inv-done']);
        expect((await db.select().from(schema.qboEntityMap).where(eq(schema.qboEntityMap.oiId, 'inv-done')).get())?.qboId)
            .toBe('QBO-EXISTING-inv-done');
        // The customer reference is the one the match created.
        expect(posts.every((p) => p.CustomerRef?.value === 'QBO-CUST-1')).toBe(true);
    });

    it('closes the open item of an invoice it pushed, and only that one', async () => {
        await seedInvoice({ id: 'inv-1' });
        await seedInvoice({ id: 'inv-other', contactId: OTHER_CONTACT });

        await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect((await errorRow('inv-1'))?.resolved).toBe(true);
        expect((await errorRow('inv-other'))?.resolved).toBe(false);
    });

    it('does not touch another contact, another company, a void invoice or a failure with another cause', async () => {
        await seedInvoice({ id: 'inv-mine' });
        await seedInvoice({ id: 'inv-other-contact', contactId: OTHER_CONTACT });
        await seedInvoice({ id: 'inv-foreign', tenantId: OTHER_TENANT, contactId: FOREIGN_CONTACT });
        await seedInvoice({ id: 'inv-void', voidedAt: T0 });
        await seedInvoice({ id: 'inv-other-cause', errorMsg: 'QBO invoice update failed after 3 attempts' });
        await seedInvoice({ id: 'inv-never-pushed', syncStatus: null });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result.attempted).toBe(1);
        expect(posts).toHaveLength(1);
        expect((await invoiceRow('inv-mine'))?.qboSyncStatus).toBe('synced');
        for (const id of ['inv-other-contact', 'inv-foreign', 'inv-void', 'inv-other-cause']) {
            expect((await invoiceRow(id))?.qboSyncStatus, id).toBe('failed');
        }
        expect((await invoiceRow('inv-never-pushed'))?.qboSyncStatus).toBeNull();
        expect(bookRows(OTHER_TENANT)).toHaveLength(0);
    });

    it('refuses to work on a contact id from another company', async () => {
        await seedInvoice({ id: 'inv-foreign', tenantId: OTHER_TENANT, contactId: FOREIGN_CONTACT });

        const asWrongCompany = await resyncInvoicesForContact(qbo, TENANT, FOREIGN_CONTACT);
        expect(asWrongCompany).toEqual({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 });
        expect(posts).toHaveLength(0);

        // Control: the owning company's own call does the work.
        const asOwner = await resyncInvoicesForContact(qbo, OTHER_TENANT, FOREIGN_CONTACT);
        expect(asOwner.attempted).toBe(1);
    });

    it('stops at the limit, oldest first, and says how many are left', async () => {
        await seedInvoice({ id: 'inv-3', createdAt: new Date('2026-03-03T10:00:00Z') });
        await seedInvoice({ id: 'inv-1', createdAt: new Date('2026-03-01T10:00:00Z') });
        await seedInvoice({ id: 'inv-2', createdAt: new Date('2026-03-02T10:00:00Z') });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT, 2);

        expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0, remaining: 1 });
        expect(posts).toHaveLength(2);
        expect((await invoiceRow('inv-1'))?.qboSyncStatus).toBe('synced');
        expect((await invoiceRow('inv-2'))?.qboSyncStatus).toBe('synced');
        expect((await invoiceRow('inv-3'))?.qboSyncStatus).toBe('failed');
    });

    it('has a default limit well under a free plan\'s per-request allowance', () => {
        expect(RESYNC_INVOICE_LIMIT).toBe(10);
    });

    it('applies the limit it is given even when it is nonsense', async () => {
        await seedInvoice({ id: 'inv-1' });
        await seedInvoice({ id: 'inv-2' });

        expect((await resyncInvoicesForContact(qbo, TENANT, CONTACT, 0)).attempted).toBe(0);
        expect((await resyncInvoicesForContact(qbo, TENANT, CONTACT, 1_000_000)).attempted).toBe(2);
    });

    it('carries on after one invoice fails', async () => {
        await seedInvoice({ id: 'inv-1', createdAt: new Date('2026-03-01T10:00:00Z') });
        await seedInvoice({ id: 'inv-2', createdAt: new Date('2026-03-02T10:00:00Z') });
        failNextPosts = 1;

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
        expect((await invoiceRow('inv-1'))?.qboSyncStatus).toBe('failed');
        expect((await invoiceRow('inv-2'))?.qboSyncStatus).toBe('synced');
        // The failed one keeps an open item; the pushed one has none.
        expect((await errorRow('inv-1'))?.resolved).toBe(false);
        expect((await errorRow('inv-2'))?.resolved).toBe(true);
    });

    it('reports a push that throws as failed instead of throwing, and writes no text of its own', async () => {
        await seedInvoice({ id: 'inv-1' });
        const before = await db.select().from(schema.qboSyncErrors).all();
        const boom = { getDrizzle: () => qbo.getDrizzle(), upsertInvoice: async () => { throw new Error('token store down'); } };

        await expect(resyncInvoicesForContact(boom, TENANT, CONTACT)).resolves.toMatchObject({ attempted: 1, failed: 1, succeeded: 0 });

        // The re-sync records nothing about a failure itself: the open item is
        // exactly what it was, and the thrown message is only in the log.
        expect(await db.select().from(schema.qboSyncErrors).all()).toEqual(before);
    });

    it('is a no-op the second time: nothing is created twice', async () => {
        await seedInvoice({ id: 'inv-1' });
        await seedInvoice({ id: 'inv-2' });

        const first = await resyncInvoicesForContact(qbo, TENANT, CONTACT);
        const second = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(first.attempted).toBe(2);
        expect(second).toEqual({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 });
        expect(posts).toHaveLength(2);
        expect(bookRows(TENANT)).toHaveLength(2);
    });
});

describe('resyncInvoicesForContact: what stays out, and how long it may run', () => {
    it('leaves a paid or part-paid invoice alone (positive control: the unpaid one is pushed)', async () => {
        await seedInvoice({ id: 'inv-unpaid' });
        await seedInvoice({ id: 'inv-paid', paidAt: T0 });
        await seedInvoice({ id: 'inv-part', partialPaidAt: T0 });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result.attempted).toBe(1);
        expect(invoiceRow('inv-unpaid')?.qboSyncStatus).toBe('synced');
        expect(invoiceRow('inv-paid')?.qboSyncStatus).toBe('failed');
        expect(invoiceRow('inv-part')?.qboSyncStatus).toBe('failed');
    });

    it('does not push an invoice that is already on the books even if a stale item is still open', async () => {
        await seedInvoice({ id: 'inv-booked', onTheBooks: true });
        await seedInvoice({ id: 'inv-open' });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result.attempted).toBe(1);
        expect(posts).toHaveLength(1);
        expect(bookRows(TENANT).map((r) => r.oiId).sort()).toEqual(['inv-booked', 'inv-open']);
    });

    it("trusts the invoice own contact, not the text of the open item", async () => {
        // The open item names CONTACT, but the invoice belongs to OTHER_CONTACT.
        await seedInvoice({ id: 'inv-forged', contactId: OTHER_CONTACT, errorMsg: noCustomerFailureMessage(CONTACT) });
        await seedInvoice({ id: 'inv-mine' });

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT);

        expect(result.attempted).toBe(1);
        expect(invoiceRow('inv-forged')?.qboSyncStatus).toBe('failed');
        expect(invoiceRow('inv-mine')?.qboSyncStatus).toBe('synced');
    });

    it('stops starting pushes once its time budget is spent and reports the rest as remaining', async () => {
        for (const n of [1, 2, 3, 4]) await seedInvoice({ id: `inv-${n}`, createdAt: new Date(T0.getTime() + n) });
        let t = 0;
        // Each look at the clock is 10 seconds later than the last.
        const clock = { now: () => (t += 10_000), budgetMs: 25_000 };

        const result = await resyncInvoicesForContact(qbo, TENANT, CONTACT, 10, clock);

        expect(result.attempted).toBe(2);
        expect(result.remaining).toBe(2);
        expect(posts).toHaveLength(2);
        // Positive control: with the real clock the same four all go through.
        const full = await resyncInvoicesForContact(qbo, TENANT, CONTACT);
        expect(full.attempted).toBe(2);
        expect(full.remaining).toBe(0);
    });

    it('keeps the wording of the open item stable, because the re-sync finds failed invoices by it', () => {
        expect(noCustomerFailureMessage('c-1')).toBe('Cannot send to QuickBooks: contact c-1 has no QuickBooks customer yet');
    });
});

describe('POST /contacts/:contactId/link and the re-sync', () => {
    const exec = makeExecutionContext();
    let resolveResync: () => void;
    const upsertInvoice = vi.fn();

    function app(over: { linkFails?: boolean; upsertFails?: boolean } = {}) {
        const svc = {
            linkExistingCustomer: vi.fn(async () => {
                if (over.linkFails) throw new Error('boom');
                return { qboCustomerId: '58', displayName: 'Customer 58', replacedQboCustomerId: null, resolvedErrorCount: 0 };
            }),
            getDrizzle: () => qbo.getDrizzle(),
            upsertInvoice: (tenantId: string, input: unknown) => {
                upsertInvoice(tenantId, input);
                return over.upsertFails
                    ? Promise.reject(new Error('QuickBooks is down'))
                    : new Promise<void>((resolve) => { resolveResync = resolve; });
            },
        };
        const a = new Hono<HonoConfig>();
        a.onError((_err, c) => c.json({ success: false }, 500));
        a.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'owner');
            c.set('keyringPromise', Promise.resolve({} as never));
            c.set('user', { sub: 'u1' } as never);
            c.set('services', { qbo: svc } as never);
            return next();
        });
        a.route('/api/integrations/qbo', qboRoutes);
        return { a, svc };
    }
    const post = (a: Hono<HonoConfig>) => a.request(`/api/integrations/qbo/contacts/${CONTACT}/link`, {
        method: 'POST',
        headers: { Cookie: '__Host-inspector_token=stub', 'Content-Type': 'application/json' },
        body: JSON.stringify({ qboCustomerId: '58' }),
    }, {}, exec.ctx);

    beforeEach(() => { upsertInvoice.mockClear(); });

    it('answers before the re-sync finishes, and the re-sync runs for this company and contact', async () => {
        await seedInvoice({ id: 'inv-1' });

        const res = await post(app().a);

        // The push is still pending (its promise has not been resolved) and the
        // response is already here.
        expect(res.status).toBe(200);
        await vi.waitFor(() => expect(upsertInvoice).toHaveBeenCalledTimes(1));
        expect(upsertInvoice.mock.calls[0]?.[0]).toBe(TENANT);
        expect((upsertInvoice.mock.calls[0]?.[1] as { id: string }).id).toBe('inv-1');
        resolveResync();
    });

    it('keeps the match when the re-sync fails', async () => {
        await seedInvoice({ id: 'inv-1' });

        const res = await post(app({ upsertFails: true }).a);
        await exec.settle();

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, data: { qboCustomerId: '58' } });
        expect(upsertInvoice).toHaveBeenCalledTimes(1);
    });

    it('does not re-sync when the match itself failed', async () => {
        await seedInvoice({ id: 'inv-1' });

        const res = await post(app({ linkFails: true }).a);
        await exec.settle();

        expect(res.status).toBe(500);
        expect(upsertInvoice).not.toHaveBeenCalled();
    });
});
