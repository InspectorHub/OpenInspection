/**
 * `upsertInvoice` — the push that puts an invoice on the tenant's books.
 *
 * It had no direct coverage at all. Everything around it did: the payment push,
 * the credit memo, the CDC sweep. The function that creates the QuickBooks
 * Invoice those three all hang off did not, and it is the one carrying the
 * optimistic-concurrency retry.
 *
 * These specs drive the REAL `apiCall` against a stubbed `fetch` rather than
 * overriding `apiCall` the way `payment-push.spec.ts` does, because two of the
 * behaviours under test are decisions made about the ERROR OBJECT `apiCall`
 * throws (`status`, `qboResponse`). Stubbing at the method boundary would mean
 * hand-building that object, and a test that invents the shape it then asserts
 * on cannot fail when production changes it.
 *
 * Rows are read back out of SQLite wherever a row exists to read: what matters
 * to the next push is the SyncToken that landed in `qbo_entity_map`, not the
 * one that went out on the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const CONTACT = 'contact-aaaa-0000-0000-000000000001';
const REALM = 'realm-1';
const QBO_INV = 'QBO-INV-77';

const T0 = new Date('2026-03-01T10:00:00Z');
/** Comfortably outside `getToken`'s 5-minute refresh window, so no token round-trip. */
const TOKEN_GOOD_UNTIL = new Date(Date.now() + 24 * 3_600_000);

class TestQbo extends withInvoiceSync(QBOServiceBase) {}

/** The invoice the push is handed — the shape `InvoiceService` passes it. */
const INVOICE_INPUT = {
    id:            INV,
    invoiceNumber: 'INV-001',
    contactId:     CONTACT,
    dueDate:       '2026-09-30',
    lineItems:     [{ description: 'Full home inspection', amountCents: 45000 }],
    status:        'sent',
};

// --- the wire ------------------------------------------------------------

interface Sent { method: string; endpoint: string; url: string; body: any }
type Reply = { status: number; body: unknown };

let sent: Sent[] = [];
let replies: Reply[] = [];

const ok = (body: unknown): Reply => ({ status: 200, body });
/** A QuickBooks validation fault — the envelope `apiCall` hangs `qboResponse` off. */
const fault = (status: number, code: string, message: string): Reply => ({
    status,
    body: { Fault: { Error: [{ code, Message: message, Detail: message }], type: 'ValidationFault' } },
});
/** The specific 400 the retry exists for. */
const STALE_TOKEN = () => fault(400, '5010', 'Stale Object Error');

// QuickBooks v3 has no PUT: an update is a POST carrying `Id` and `SyncToken`.
// The verb therefore no longer separates create from update — the BODY does,
// which is the honest discriminator in production too.
const updates = () => sent.filter((s) => s.method === 'POST' && !!s.body?.Id);
const gets = () => sent.filter((s) => s.method === 'GET');

function installFetch() {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: RequestInit | undefined) => {
        const url = String(input);
        const after = url.split(`/v3/company/${REALM}/`)[1] ?? url;
        sent.push({
            method:   init?.method ?? 'GET',
            endpoint: after.split('?')[0],
            url,
            body:     typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const reply = replies.shift();
        // Never silently answer 200: an unplanned call must break the test that
        // did not plan for it, not fall into `created.Invoice.Id` and surface as
        // a TypeError several frames away.
        if (!reply) throw new Error(`unplanned QBO call: ${init?.method ?? 'GET'} ${url}`);
        return new Response(JSON.stringify(reply.body), {
            status: reply.status, headers: { 'content-type': 'application/json' },
        });
    }));
}

// --- fixtures ------------------------------------------------------------

let db: BetterSQLite3Database<typeof schema>;
let qbo: TestQbo;

const mapRow = (oiType: string, oiId: string) => db.select().from(schema.qboEntityMap)
    .where(and(
        eq(schema.qboEntityMap.tenantId, TENANT),
        eq(schema.qboEntityMap.oiType, oiType),
        eq(schema.qboEntityMap.oiId, oiId),
    )).get();

const invoiceRow = () => db.select().from(schema.invoices).where(eq(schema.invoices.id, INV)).get();

const syncErrors = () => db.select().from(schema.qboSyncErrors)
    .where(eq(schema.qboSyncErrors.tenantId, TENANT)).all();

/** An existing QBO twin for the invoice, holding whatever SyncToken QBO last gave us. */
async function seedInvoiceMapping(syncToken: string) {
    await db.insert(schema.qboEntityMap).values({
        id: 'map-invoice', tenantId: TENANT, oiType: 'invoice', oiId: INV,
        qboType: 'Invoice', qboId: QBO_INV, qboSyncToken: syncToken, syncedAt: T0,
    });
}

beforeEach(async () => {
    sent = [];
    replies = [];
    installFetch();

    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    qbo = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa', 'sandbox');

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: T0,
    });
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-03-01', createdAt: T0,
    } as never);
    await db.insert(schema.contacts).values({
        id: CONTACT, tenantId: TENANT, type: 'client', name: 'Pat Client', createdAt: T0,
    } as never);
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: REALM, accessToken: 'enc:access', refreshToken: 'enc:refresh',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        defaultItemId: 'ITEM-7', createdAt: T0,
    });
    await db.insert(schema.invoices).values({
        id: INV, tenantId: TENANT, inspectionId: INSP, contactId: CONTACT,
        amountCents: 45000, lineItems: [{ description: 'Full home inspection', amountCents: 45000 }],
        createdAt: T0, currency: 'USD',
    } as never);
    // The contact's QBO twin — without it the invoice would carry no CustomerRef.
    await db.insert(schema.qboEntityMap).values({
        id: 'map-contact', tenantId: TENANT, oiType: 'contact', oiId: CONTACT,
        qboType: 'Customer', qboId: 'QBO-CUST-9', qboSyncToken: '0', syncedAt: T0,
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

// --- create --------------------------------------------------------------

describe('creating the QuickBooks invoice', () => {
    it('POSTs once and records the id and SyncToken QuickBooks returned', async () => {
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('POST');
        expect(sent[0].endpoint).toBe('invoice');

        // The row is the point: the next push reads its SyncToken, so a push that
        // reached QuickBooks and wrote nothing here is a push that can never
        // update the invoice it just created.
        const row = await mapRow('invoice', INV);
        expect(row).toMatchObject({
            qboType: 'Invoice', qboId: QBO_INV, qboSyncToken: '0', tenantId: TENANT,
        });
    });

    it('carries the doc number, the mapped customer, and dollar amounts', async () => {
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent[0].body).toMatchObject({
            DocNumber:   'INV-001',
            DueDate:     '2026-09-30',
            EmailStatus: 'EmailSent',
            CustomerRef: { value: 'QBO-CUST-9' },
        });
        // Cents in our ledger, dollars on the wire — a missing `/ 100` is a
        // hundred times the invoice on a customer's books.
        expect(sent[0].body.Line[0]).toMatchObject({
            Amount: 450,
            SalesItemLineDetail: { ItemRef: { value: 'ITEM-7' }, UnitPrice: 450, Qty: 1 },
        });
    });

    it("marks the invoice 'synced'", async () => {
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        expect((await invoiceRow())?.qboSyncStatus).toBe('synced');
    });

    it('pushes nothing at all when the tenant has no QuickBooks connection', async () => {
        await db.delete(schema.qboConnections).where(eq(schema.qboConnections.tenantId, TENANT));

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent).toHaveLength(0);
        // Not 'failed' either: no connection is the common state, not an error.
        expect((await invoiceRow())?.qboSyncStatus).toBeNull();
        expect(await syncErrors()).toHaveLength(0);
    });
});

// --- update --------------------------------------------------------------

describe('updating an already-mapped invoice', () => {
    it('POSTs the update with the SyncToken held in the map, and stores the one returned', async () => {
        await seedInvoiceMapping('3');
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '4' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('POST');
        expect(sent[0].body).toMatchObject({ Id: QBO_INV, SyncToken: '3' });

        const row = await mapRow('invoice', INV);
        expect(row?.qboSyncToken).toBe('4');
        expect(row?.syncedAt.getTime()).toBeGreaterThan(T0.getTime());
    });

    it('creates no second map row', async () => {
        await seedInvoiceMapping('3');
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '4' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        const rows = await db.select().from(schema.qboEntityMap)
            .where(eq(schema.qboEntityMap.oiType, 'invoice')).all();
        expect(rows).toHaveLength(1);
    });

    it('clears an earlier failed status once the update succeeds', async () => {
        // The update branch used to `return` from inside the retry loop, so it
        // skipped the `qboSyncStatus: 'synced'` write that follows the if/else.
        // An invoice whose first push failed therefore read 'failed' forever,
        // however many times it was successfully pushed afterwards.
        await seedInvoiceMapping('3');
        await db.update(schema.invoices).set({ qboSyncStatus: 'failed' })
            .where(eq(schema.invoices.id, INV));
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '4' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect((await mapRow('invoice', INV))?.qboSyncToken).toBe('4');   // the push DID succeed
        expect((await invoiceRow())?.qboSyncStatus).toBe('synced');       // and the status followed it
    });
});

// --- the stale-SyncToken retry -------------------------------------------

describe('the stale-SyncToken retry', () => {
    it('refetches the current SyncToken and retries once with it', async () => {
        // Somebody edited the invoice inside QuickBooks: our stored token is one
        // behind, and QBO refuses the write rather than clobbering their edit.
        await seedInvoiceMapping('3');
        replies = [
            STALE_TOKEN(),
            ok({ Invoice: { Id: QBO_INV, SyncToken: '9' } }),   // the refetch
            ok({ Invoice: { Id: QBO_INV, SyncToken: '10' } }),  // the retry
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent.map((s) => `${s.method} ${s.endpoint}`)).toEqual([
            'POST invoice', `GET invoice/${QBO_INV}`, 'POST invoice',
        ]);
        expect(updates()[0].body.SyncToken).toBe('3');   // the stale one
        expect(updates()[1].body.SyncToken).toBe('9');   // the refetched one
        expect(updates()[1].body.Id).toBe(QBO_INV);

        const row = await mapRow('invoice', INV);
        expect(row?.qboSyncToken).toBe('10');
        // A retry that lands is still a success, and the status write is the
        // only thing a tenant sees say so.
        expect((await invoiceRow())?.qboSyncStatus).toBe('synced');
    });

    it('does not loop forever — three attempts and it stops', async () => {
        await seedInvoiceMapping('3');
        replies = [
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '9' } }),
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '10' } }),
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '11' } }),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        // Bounded, and it consumed exactly the six replies queued — any unplanned
        // seventh call throws out of the fetch stub.
        expect(updates()).toHaveLength(3);
        expect(gets()).toHaveLength(3);
        expect(replies).toHaveLength(0);
        // Every PUT used the token the preceding GET handed back.
        expect(updates().map((p) => p.body.SyncToken)).toEqual(['3', '9', '10']);
    });

    it('does not report success when every stale-token retry is exhausted', async () => {
        // The loop used to fall out of its `for` without returning and without
        // throwing, so control landed on the `qboSyncStatus: 'synced'` write
        // below the if/else. Nothing reached QuickBooks, the map still held the
        // stale token, no `qbo_sync_errors` row was filed — and the invoice read
        // as synced. That is the failure mode a tenant cannot see.
        await seedInvoiceMapping('3');
        replies = [
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '9' } }),
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '10' } }),
            STALE_TOKEN(), ok({ Invoice: { Id: QBO_INV, SyncToken: '11' } }),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect((await invoiceRow())?.qboSyncStatus).toBe('failed');
        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ oiType: 'invoice', oiId: INV, resolved: false });
        // The map row is only ever written on success, so the three refetched
        // tokens are discarded and the stored one is still the stale '3'.
        expect((await mapRow('invoice', INV))?.qboSyncToken).toBe('3');
    });

    it('retries on ANY 400, not only on a stale-token fault', async () => {
        // Pinning what the code reads: the branch tests `err.status === 400` and
        // never looks at the fault code, so a genuine validation rejection is
        // also refetched and re-sent unchanged — three round-trips to QuickBooks
        // for a payload that cannot succeed.
        await seedInvoiceMapping('3');
        replies = [
            fault(400, '6000', 'A business validation error has occurred'),
            ok({ Invoice: { Id: QBO_INV, SyncToken: '9' } }),
            ok({ Invoice: { Id: QBO_INV, SyncToken: '10' } }),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(updates()).toHaveLength(2);
        expect(gets()).toHaveLength(1);
    });

    it('does not retry a non-400 refusal', async () => {
        await seedInvoiceMapping('3');
        replies = [fault(403, '3200', 'ApplicationAuthenticationFailed')];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent).toHaveLength(1);
        expect((await invoiceRow())?.qboSyncStatus).toBe('failed');
        expect((await mapRow('invoice', INV))?.qboSyncToken).toBe('3');   // untouched
    });
});

// --- the accounting date -------------------------------------------------

describe('the transaction date', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 02:00 UTC on the 1st is still 18:00 on the 28th in Los Angeles. At a
        // month boundary a one-day error is a one-PERIOD error: the invoice
        // lands in March on books that closed February.
        vi.setSystemTime(new Date('2026-03-01T02:00:00.000Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    async function seedTimezone(tz: string) {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: tz, updatedAt: T0,
        } as never);
    }

    it("dates the transaction in the tenant's timezone, not UTC", async () => {
        await seedTimezone('America/Los_Angeles');
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent[0].body.TxnDate).toBe('2026-02-28');
    });

    it('sends the UTC date when the tenant IS in UTC', async () => {
        // Positive control. Without it the assertion above would also pass on
        // code that hard-coded a date, or that subtracted a fixed offset.
        await seedTimezone('UTC');
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect(sent[0].body.TxnDate).toBe('2026-03-01');
    });

    it('falls back to that same date for DueDate when the invoice carries none', async () => {
        await seedTimezone('America/Los_Angeles');
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];

        await qbo.upsertInvoice(TENANT, { ...INVOICE_INPUT, dueDate: null });

        expect(sent[0].body).toMatchObject({ TxnDate: '2026-02-28', DueDate: '2026-02-28' });
    });
});

// --- failure ------------------------------------------------------------

describe('a failed push', () => {
    it("marks the invoice 'failed' and files a sync error keyed on the invoice", async () => {
        replies = [fault(403, '3200', 'ApplicationAuthenticationFailed')];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect((await invoiceRow())?.qboSyncStatus).toBe('failed');
        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            tenantId: TENANT, oiType: 'invoice', oiId: INV,
            errorCode: 'SYNC_ERROR', resolved: false, retries: 0,
        });
        // The status AND what QuickBooks said about it. This assertion used to
        // read `errorMsg: 'QBO 403'` exactly — and passed, because that really
        // was the whole of what got recorded for every failure the integration
        // could produce.
        expect(errors[0]!.errorMsg).toContain('QBO 403');
        expect(errors[0]!.errorMsg).toContain('ApplicationAuthenticationFailed');
        // Nothing was created remotely, so nothing may be mapped: a map row here
        // would send every later push down the update branch against an id
        // QuickBooks does not have.
        expect(await mapRow('invoice', INV)).toBeUndefined();
    });

    it('refreshes the same open row rather than stacking one per attempt', async () => {
        replies = [
            fault(403, '3200', 'ApplicationAuthenticationFailed'),
            fault(403, '3200', 'ApplicationAuthenticationFailed'),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].retries).toBe(1);
    });

    it('SUSPECTED DEFECT: a later success does not resolve the error it replaces', async () => {
        // `upsertInvoice` never touches `qbo_sync_errors` on the success path, so
        // the open row outlives the problem. The Books health card counts open
        // rows (`QBOConnectionStatus.openErrors`), so the tenant keeps being told
        // about a failure that has already been fixed — and the invoice itself
        // says 'synced' at the same time.
        replies = [
            fault(403, '3200', 'ApplicationAuthenticationFailed'),
            ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } }),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect((await invoiceRow())?.qboSyncStatus).toBe('synced');
        expect(await mapRow('invoice', INV)).toBeTruthy();
        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].resolved).toBe(false);
    });

    it("never writes 'pending' — the third enum value has no producer", async () => {
        // The schema comment claims it; this is the claim made executable, so a
        // future path that starts producing 'pending' has to update the comment.
        replies = [
            fault(403, '3200', 'ApplicationAuthenticationFailed'),
            ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } }),
        ];
        const seen: Array<string | null> = [];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        seen.push((await invoiceRow())?.qboSyncStatus ?? null);
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        seen.push((await invoiceRow())?.qboSyncStatus ?? null);

        expect(seen).toEqual(['failed', 'synced']);
    });
});

/**
 * NOT COVERED HERE, DELIBERATELY.
 *
 * `buildDocNumber` is unit-tested in `tests/unit/integrations/qbo.service.spec.ts`
 * (truncation at 21 chars, both branches). Restating it here would be a second
 * copy to keep true.
 *
 * `txnDateFor` itself is exercised through its other callers in
 * `payment-push.spec.ts` and `refund-push.spec.ts` (occurred-at rather than push
 * date). What the timezone block above pins is narrower and belongs here: that
 * `upsertInvoice` goes through that one helper at all. It used to send
 * `new Date().toISOString().slice(0, 10)` — the push date in UTC — which was the
 * fourth date path the `txnDateFor` docblock says it exists to prevent.
 */

/**
 * The push refuses to run when it has no customer to name.
 *
 * QuickBooks requires `CustomerRef` on an Invoice and rejects the whole
 * document without it. Production reached that state on EVERY invoice, because
 * nothing wrote `invoices.contact_id` — the fixture above supplies it, which is
 * why this suite could not see it (`tests/unit/invoices/invoice-contact-link.spec.ts`
 * covers the write path itself).
 *
 * Refusing here rather than letting QuickBooks refuse is not just a saved round
 * trip: the answer names OUR missing data, which is the thing the operator can
 * actually fix, and it reads the same whether the invoice has no contact or the
 * contact has never synced.
 */
describe('an invoice with no QuickBooks customer', () => {
    async function dropContactMapping() {
        await db.delete(schema.qboEntityMap)
            .where(eq(schema.qboEntityMap.oiType, 'contact'));
    }

    it('makes no API call at all', async () => {
        await dropContactMapping();
        replies = [];   // installFetch throws on any unplanned call
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        expect(sent).toEqual([]);
    });

    it('records the failure against the invoice, naming what is missing', async () => {
        await dropContactMapping();
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        expect((await invoiceRow())?.qboSyncStatus).toBe('failed');
        const errors = syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]!.errorMsg).toContain('QuickBooks');
        expect(errors[0]!.errorMsg).toContain(CONTACT);
    });

    it('says something different when the invoice has no contact at all', async () => {
        await dropContactMapping();
        await qbo.upsertInvoice(TENANT, { ...INVOICE_INPUT, contactId: null });
        expect(syncErrors()[0]!.errorMsg).toContain('no contact');
    });

    it('still pushes normally once the contact has a twin — the positive control', async () => {
        // Without this, deleting the whole push would satisfy the three above.
        replies = [ok({ Invoice: { Id: QBO_INV, SyncToken: '0' } })];
        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);
        expect(sent).toHaveLength(1);
        expect((await invoiceRow())?.qboSyncStatus).toBe('synced');
    });
});

/**
 * When the update runs out of attempts, the row repeats QuickBooks' words.
 *
 * It used to assert a cause instead: "after 3 stale-token retries". A stale
 * token is only one of the things a 400 means, and the loop cannot tell which
 * it got — an invalid reference refetches cleanly and fails the same way three
 * times over. The reader was then sent to look at a token that was fine.
 */
describe('a failing update reports what QuickBooks refused', () => {
    it('carries the fault detail into the error row', async () => {
        await seedInvoiceMapping('3');
        const invalidRef = () => fault(400, '2500', 'Invalid Reference Id : Names element id 999999 not found');
        replies = [
            invalidRef(), ok({ Invoice: { Id: QBO_INV, SyncToken: '3' } }),
            invalidRef(), ok({ Invoice: { Id: QBO_INV, SyncToken: '3' } }),
            // The third failure ALSO refetches before the loop condition ends
            // it, so the sequence is three POSTs and three GETs, not three and
            // two. Planning one fewer makes the suite report the shortfall
            // instead of the assertion under test.
            invalidRef(), ok({ Invoice: { Id: QBO_INV, SyncToken: '3' } }),
        ];

        await qbo.upsertInvoice(TENANT, INVOICE_INPUT);

        const msg = syncErrors()[0]!.errorMsg ?? '';
        expect(msg).toContain('Invalid Reference Id');
        expect(msg).not.toContain('stale-token');
        expect((await invoiceRow())?.qboSyncStatus).toBe('failed');
    });
});
