/**
 * The webhook is an UNAUTHENTICATED public endpoint that names its own tenant.
 *
 * `POST /api/integrations/qbo/webhook` is excluded from JWT middleware, so the
 * only thing standing between the open internet and a tenant's books is the
 * `intuit-signature` HMAC — and the only thing that decides WHOSE books get
 * written is a realm id read out of the request body. Both live in
 * `handleWebhook` itself (the route reads the raw bytes and hands them over),
 * so both are tested here.
 *
 * The other half is robustness: Intuit retries anything that is not a 200, so
 * the route answers 200 immediately and runs this in the background. A handler
 * that throws on a payload it does not recognise therefore fails where nobody
 * is watching, and takes the rest of the batch with it.
 *
 * The signature is recomputed in the test with node's `crypto`, not with the
 * service's own WebCrypto path — an independent implementation, so these
 * specs prove the handler matches base64 HMAC-SHA256 rather than proving it
 * agrees with itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOService } from '../../../server/services/qbo.service';
import { QBOCloudEventSchema, type QBOCloudEvent } from '../../../server/lib/validations/qbo.schema';
import { InvoiceService } from '../../../server/services/invoice.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTION = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const QBO_ID = '147';
const REALM = '9130350000000000';
const OTHER_REALM = '4620816365000000';
const WEBHOOK_SECRET = 'intuit-verifier-token';
const TOTAL_CENTS = 45000;

const T0 = new Date('2026-03-01T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date('2027-01-01T00:00:00Z');

let db: BetterSQLite3Database<typeof schema>;
let qbo: QBOService;
let invoiceSvc: InvoiceService;
let markPaid: ReturnType<typeof vi.fn>;
let markPartial: ReturnType<typeof vi.fn>;
/** Every QuickBooks API path the handler reached for, in order. */
let apiPaths: string[];
/** What the handler said about the events it decided not to process. */
const silenceWarn = () => vi.spyOn(logger, 'warn').mockImplementation(() => {});
let warnSpy: ReturnType<typeof silenceWarn>;

/** Exactly what the route computes over: base64 HMAC-SHA256 of the raw bytes. */
const sign = (rawBody: string) =>
    createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');

/**
 * Built through the real schema so the payload cannot drift from the shape the
 * handler will accept — a hand-written literal would keep passing after a
 * required field was added.
 */
function cloudEvent(over: Record<string, unknown> = {}): QBOCloudEvent {
    return QBOCloudEventSchema.parse({
        specversion:     '1.0',
        id:              'a1b2c3d4-0000-4000-8000-000000000001',
        source:          '/services/quickbooks/v3',
        type:            'qbo.invoice.updated.v1',
        datacontenttype: 'application/json',
        time:            '2026-03-05T10:00:00Z',
        intuitentityid:  QBO_ID,
        intuitaccountid: REALM,
        data:            { name: 'Invoice', operation: 'Update' },
        ...over,
    });
}

/** QuickBooks answers the invoice fetch: $450 invoiced, nothing outstanding. */
function stubInvoiceFetch(syncToken = '9', balance = 0) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        apiPaths.push(url.pathname);
        return new Response(
            JSON.stringify({ Invoice: { Id: QBO_ID, SyncToken: syncToken, Balance: balance, TotalAmt: 450 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
    }));
}

const mapRow = () => db.select().from(schema.qboEntityMap)
    .where(eq(schema.qboEntityMap.oiId, INV_ID)).get();

const invoiceRow = () => db.select().from(schema.invoices)
    .where(eq(schema.invoices.id, INV_ID)).get();

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    apiPaths = [];
    warnSpy = silenceWarn();

    qbo = new QBOService({} as D1Database, 'cid', 'csec', WEBHOOK_SECRET, 'a'.repeat(32), 'sandbox');
    invoiceSvc = new InvoiceService({} as D1Database);
    markPaid = vi.fn((id: string, tid: string) => invoiceSvc.markPaid(id, tid, 'qbo'));
    markPartial = vi.fn((id: string, cents: number, tid: string) => invoiceSvc.markPartial(id, tid, 'qbo', cents));

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: T0,
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-03-01', createdAt: T0,
    });
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: INSPECTION, amountCents: TOTAL_CENTS,
        lineItems: [{ description: 'Inspection', amountCents: TOTAL_CENTS }],
        sentAt: T0, createdAt: T0, currency: 'CAD',
    });
    await db.insert(schema.qboEntityMap).values({
        id: 'map-1', tenantId: TENANT, oiType: 'invoice', oiId: INV_ID,
        qboType: 'Invoice', qboId: QBO_ID, qboSyncToken: '1', syncedAt: T0,
    });
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: REALM, companyName: 'Sandbox Co',
        accessToken: 'enc:at', refreshToken: 'enc:rt',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        syncEnabled: true, defaultItemId: '1', createdAt: T0,
    });

    stubInvoiceFetch();
});

afterEach(() => { vi.unstubAllGlobals(); warnSpy.mockRestore(); });

const deliver = (payload: unknown, signature?: string) => {
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return qbo.handleWebhook(rawBody, signature ?? sign(rawBody), markPaid as never, markPartial as never);
};

describe('a genuine invoice notification', () => {
    it('resolves the realm, fetches that invoice, and applies it to our row', async () => {
        const result = await deliver(cloudEvent());

        expect(result).toEqual({ valid: true });
        // The realm in the body is what chose the tenant AND the credentials:
        // the fetched path proves both, since the company id is in the URL.
        expect(apiPaths).toEqual([`/v3/company/${REALM}/invoice/${QBO_ID}`]);
        // The rows are the point. A mock-argument assertion would also pass
        // against a handler that fetched the invoice and dropped it.
        expect(mapRow()!.qboSyncToken).toBe('9');
        expect(invoiceRow()!.paidAt).not.toBeNull();
        expect(markPaid).toHaveBeenCalledWith(INV_ID, TENANT);
    });

    it('carries the partial figure through in CENTS, not dollars', async () => {
        // QuickBooks reports a remaining balance in dollars; adapters take the
        // amount RECEIVED in integer cents. $450 total, $90 outstanding.
        stubInvoiceFetch('9', 90);

        await deliver(cloudEvent());

        expect(markPartial).toHaveBeenCalledWith(INV_ID, 36000, TENANT);
        expect(invoiceRow()!.amountPaidCents).toBe(36000);
    });
});

describe('nothing happens without a valid signature', () => {
    it('rejects a forged signature and touches nothing', async () => {
        const result = await deliver(cloudEvent(), 'Zm9yZ2VkLXNpZ25hdHVyZQ==');

        expect(result).toEqual({ valid: false });
        // Not even the READ happens: an unsigned body must not be able to make
        // this worker spend a tenant's Intuit quota, let alone write a row.
        expect(apiPaths).toEqual([]);
        expect(mapRow()!.qboSyncToken).toBe('1');
        expect(invoiceRow()!.paidAt).toBeNull();
    });

    it('rejects a signature computed over DIFFERENT bytes', async () => {
        // The classic mistake is signing a re-serialized body. Intuit signs the
        // exact bytes it sent, so a signature over anything else must fail.
        const body = JSON.stringify(cloudEvent());
        const result = await deliver(body, sign(`${body} `));

        expect(result).toEqual({ valid: false });
        expect(apiPaths).toEqual([]);
    });

    it('verifies the signature without a short-circuiting comparison', async () => {
        // This verifier is reachable from the open internet, so the comparison
        // is done by `crypto.subtle.verify` rather than `===`. What a test can
        // pin is the contract around it: the genuine signature is accepted, and
        // a wrong one of exactly the right length — the shape a timing attack
        // walks through — is still refused.
        const body = JSON.stringify(cloudEvent());
        const good = sign(body);
        const bad = 'A'.repeat(good.length);

        await expect(qbo.verifyWebhookSignature(body, good)).resolves.toBe(true);
        await expect(qbo.verifyWebhookSignature(body, bad)).resolves.toBe(false);
    });

    it('rejects a signature header that is not base64 instead of throwing', async () => {
        // Decoding the header to bytes is a step `===` never had to take, so it
        // is a new way for this handler to throw. It runs in `waitUntil` behind
        // an already-sent 200: a throw here is unobserved and never retried.
        const body = JSON.stringify(cloudEvent());

        await expect(qbo.verifyWebhookSignature(body, 'not base64 at all !!')).resolves.toBe(false);
        await expect(deliver(body, 'not base64 at all !!')).resolves.toEqual({ valid: false });
        expect(apiPaths).toEqual([]);
    });
});

describe('payloads the handler must survive', () => {
    it('ignores an event for a realm this deployment does not know', async () => {
        // Anyone who learns the verifier token of a shared app can send a realm
        // we have never connected. It must be a no-op, not a crash and not a
        // write against some other tenant's rows.
        const result = await deliver(cloudEvent({ intuitaccountid: OTHER_REALM }));

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
        expect(mapRow()!.qboSyncToken).toBe('1');
        expect(invoiceRow()!.paidAt).toBeNull();
        expect(markPaid).not.toHaveBeenCalled();
    });

    it('ignores an entity type that is not an invoice', async () => {
        const result = await deliver(cloudEvent({ type: 'qbo.customer.updated.v1' }));

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
        expect(markPaid).not.toHaveBeenCalled();
    });

    it('ignores a type string with too few segments to name an operation', async () => {
        const result = await deliver(cloudEvent({ type: 'qbo.invoice.updated' }));

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
    });

    it('drops an event missing a required field instead of throwing', async () => {
        const incomplete: Record<string, unknown> = { ...cloudEvent() };
        delete incomplete.intuitaccountid;

        const result = await deliver(incomplete);

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
        expect(invoiceRow()!.paidAt).toBeNull();
    });

    it('drops a body that is not JSON at all instead of throwing', async () => {
        const result = await deliver('<html>502 Bad Gateway</html>');

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
    });

    it('still processes the good event in a batch that also contains a bad one', async () => {
        // Intuit delivers arrays. One unparseable member must not cost the
        // others their notification — they are not redelivered.
        const result = await deliver([{ specversion: '1.0' }, cloudEvent()]);

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([`/v3/company/${REALM}/invoice/${QBO_ID}`]);
        expect(invoiceRow()!.paidAt).not.toBeNull();
    });

    it('reports how many events it dropped instead of dropping them in silence', async () => {
        // Three of the four drop paths used to be completely silent, while the
        // fourth (a failed invoice fetch) logged. So a payload shape we no
        // longer recognise returned {valid:true} with no trace: the endpoint
        // read as perfectly healthy while processing nothing at all.
        const result = await deliver([
            { specversion: '1.0' },
            cloudEvent({ type: 'qbo.customer.updated.v1' }),
            cloudEvent({ intuitaccountid: OTHER_REALM }),
            cloudEvent(),
        ]);

        expect(result).toEqual({ valid: true });
        expect(warnSpy).toHaveBeenCalledWith('QBO webhook dropped events', {
            // Both numbers, always. A count of drops with an invisible
            // denominator cannot tell "one of four" from "one of one".
            received:     4,
            handled:      1,
            unparsed:     1,
            ignoredEntity: 1,
            unknownRealm: 1,
        });
    });

    it('names a schema rejection as such, not as an unknown realm', async () => {
        // `unparsed > 0` is the one that means Intuit's payload shape stopped
        // matching ours — a different problem from a realm we never connected,
        // and it must not be reported as the same number.
        const incomplete: Record<string, unknown> = { ...cloudEvent() };
        delete incomplete.intuitaccountid;

        await deliver(incomplete);

        expect(warnSpy).toHaveBeenCalledWith('QBO webhook dropped events',
            expect.objectContaining({ received: 1, handled: 0, unparsed: 1, unknownRealm: 0 }));
    });

    it('stays quiet when every event in the batch was handled', async () => {
        // Positive control: without it, an implementation that never warns at
        // all would still satisfy the assertions above if they only checked
        // that the counts were right when they happened to be logged.
        await deliver(cloudEvent());

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('survives QuickBooks refusing the invoice fetch', async () => {
        // The route runs this in `waitUntil` after answering 200. A throw here
        // is unobserved, and Intuit will never retry it.
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            apiPaths.push(new URL(String(input)).pathname);
            return new Response(JSON.stringify({ fault: {} }), {
                status: 404, headers: { 'Content-Type': 'application/json' },
            });
        }));

        const result = await deliver(cloudEvent());

        expect(result).toEqual({ valid: true });
        expect(mapRow()!.qboSyncToken).toBe('1');
        expect(invoiceRow()!.paidAt).toBeNull();
    });
});

describe('a payment notification settles the invoices it names', () => {
    /**
     * Payment events were dropped outright — `entityType !== 'invoice'` skipped
     * them, so the ONE event QuickBooks sends when money actually arrives was
     * the one event we ignored. Inbound reconciliation happened only on the CDC
     * sweep, hours later, or on a manual Sync.
     *
     * The shape below is a capture, not a guess: `SELECT * FROM Payment` on a
     * live sandbox, 2026-08-17. `LinkedTxn` sits inside `Line`, not at the top
     * of the Payment — a top-level read finds nothing and is indistinguishable
     * from a payment we correctly ignored.
     */
    function stubPaymentThenInvoices(lines: Array<Array<{ TxnId: string; TxnType: string }>>) {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            apiPaths.push(url.pathname);
            if (url.pathname.includes('/payment/')) {
                return new Response(JSON.stringify({
                    Payment: {
                        Id: 'PAY-1', TotalAmt: 450, UnappliedAmt: 0,
                        Line: lines.map((linked) => ({ Amount: 450, LinkedTxn: linked })),
                    },
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                Invoice: { Id: QBO_ID, SyncToken: '9', Balance: 0, TotalAmt: 450 },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }));
    }

    const paymentEvent = () => cloudEvent({
        type: 'qbo.payment.created.v1',
        intuitentityid: 'PAY-1',
        data: { name: 'Payment', operation: 'Create' },
    });

    it('reads the payment, then re-reads the invoice it linked, and marks it paid', async () => {
        stubPaymentThenInvoices([[{ TxnId: QBO_ID, TxnType: 'Invoice' }]]);

        const result = await deliver(paymentEvent());

        expect(result).toEqual({ valid: true });
        // The order matters and is asserted: the payment names the invoices, so
        // it must be read first.
        expect(apiPaths).toEqual([
            `/v3/company/${REALM}/payment/PAY-1`,
            `/v3/company/${REALM}/invoice/${QBO_ID}`,
        ]);
        // The row is the point. Asserting the fetch alone would pass against a
        // handler that read both and applied neither.
        expect(invoiceRow()!.paidAt).not.toBeNull();
        expect(markPaid).toHaveBeenCalledWith(INV_ID, TENANT);
    });

    it('ignores linked transactions that are not invoices', async () => {
        // The same array carries credit memos and deposits. Treating one as an
        // invoice would re-read an id that is not an invoice id and apply
        // whatever came back.
        stubPaymentThenInvoices([[
            { TxnId: 'CM-77', TxnType: 'CreditMemo' },
            { TxnId: QBO_ID, TxnType: 'Invoice' },
        ]]);

        await deliver(paymentEvent());

        expect(apiPaths).toEqual([
            `/v3/company/${REALM}/payment/PAY-1`,
            `/v3/company/${REALM}/invoice/${QBO_ID}`,
        ]);
    });

    it('settles EVERY invoice on a multi-line payment, not just the first', async () => {
        // One cheque against three invoices is one event and three invoices to
        // re-read. A `Line[0]` implementation passes both tests above.
        stubPaymentThenInvoices([
            [{ TxnId: '100', TxnType: 'Invoice' }],
            [{ TxnId: '200', TxnType: 'Invoice' }],
        ]);

        await deliver(paymentEvent());

        expect(apiPaths).toEqual([
            `/v3/company/${REALM}/payment/PAY-1`,
            `/v3/company/${REALM}/invoice/100`,
            `/v3/company/${REALM}/invoice/200`,
        ]);
    });

    it('still ignores an entity we do not handle — the positive control', async () => {
        // Without this, "handle everything" passes the three above and would
        // fetch a customer as though it were an invoice.
        stubPaymentThenInvoices([[{ TxnId: QBO_ID, TxnType: 'Invoice' }]]);

        const result = await deliver(cloudEvent({
            type: 'qbo.customer.updated.v1',
            data: { name: 'Customer', operation: 'Update' },
        }));

        expect(result).toEqual({ valid: true });
        expect(apiPaths).toEqual([]);
        expect(markPaid).not.toHaveBeenCalled();
    });
});
