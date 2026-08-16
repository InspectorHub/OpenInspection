/**
 * The CDC sweep is a CURSOR, and a cursor's only job is to never skip a change.
 *
 * `runCDCSync` polls QuickBooks for every invoice modified since a timestamp it
 * stores on the connection row, then moves that timestamp forward. Two things
 * are therefore load-bearing and invisible from the outside: WHICH instant the
 * window opens at (including the very first run, when there is no previous
 * sync), and WHEN the stored instant is allowed to move. A cursor that advances
 * over a window it did not actually read loses those invoices permanently —
 * they are only re-offered while they still fall inside the window.
 *
 * These specs run the real sweep against real SQLite and a stubbed Intuit, and
 * assert the row that lands rather than the calls that were made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOService } from '../../../server/services/qbo.service';
import { CDC_PAGE_SIZE } from '../../../server/services/qbo/api-base';
import type { InvoiceSummary } from '../../../server/services/qbo/api-base';
import { InvoiceService } from '../../../server/services/invoice.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTION = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const QBO_ID = '147';
const REALM = '9130350000000000';
const TOTAL_CENTS = 45000;

const CONNECTED_AT = new Date('2026-03-01T10:00:00Z');
const LAST_SYNC_AT = new Date('2026-03-05T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date('2027-01-01T00:00:00Z');

/** QuickBooks reports dollars: $450 invoiced, nothing outstanding. */
const paidInFull = (id = QBO_ID, syncToken = '9'): InvoiceSummary =>
    ({ Id: id, SyncToken: syncToken, Balance: 0, TotalAmt: 450 } as InvoiceSummary);

let db: BetterSQLite3Database<typeof schema>;
let qbo: QBOService;
let invoiceSvc: InvoiceService;
let markPaid: ReturnType<typeof vi.fn>;
let markPartial: ReturnType<typeof vi.fn>;
/** Every `query=` value Intuit was asked for, in order. */
let queries: string[];
/** Every delay the sweep asked to wait, in order. See `runTimersInline`. */
let sleeps: number[];

/**
 * The sweep paces itself between page queries, and `apiCall` backs off between
 * retries the same way. A full page is 1000 invoices, so a faithful pagination
 * test would otherwise idle for real seconds. Firing every timer immediately
 * keeps the ORDER of the awaits — which is what the sweep's logic depends on —
 * while removing only the wall clock. The requested delays are recorded so a
 * test can assert WHERE the throttle sits, which is the whole point of it.
 */
function runTimersInline() {
    vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) => {
        sleeps.push(ms ?? 0);
        fn();
        return 0;
    }) as unknown as typeof setTimeout);
}

/**
 * Answers each successive `query` call with the next page. Pages beyond the
 * list come back empty, so a sweep that fails to stop terminates the test with
 * an assertion instead of a hang.
 */
function stubPages(pages: InvoiceSummary[][]) {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        queries.push(new URL(String(input)).searchParams.get('query') ?? '');
        const page = pages[call++] ?? [];
        return new Response(
            JSON.stringify({ QueryResponse: page.length ? { Invoice: page } : {} }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
    }));
}

/**
 * A 200 whose body is not the shape we document. Intuit can change a payload
 * without changing a status code, and the sweep runs inside `waitUntil`, where
 * a rejection is unhandled rather than reported.
 */
function stubMalformedOk() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        queries.push(new URL(String(input)).searchParams.get('query') ?? '');
        return new Response('{}', {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    }));
}

/** Intuit is down. `apiCall` retries three times and then throws. */
function stubServerError() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        queries.push(new URL(String(input)).searchParams.get('query') ?? '');
        return new Response(JSON.stringify({ fault: {} }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
        });
    }));
}

const connection = () => db.select().from(schema.qboConnections)
    .where(eq(schema.qboConnections.tenantId, TENANT)).get();

const mapRow = () => db.select().from(schema.qboEntityMap)
    .where(eq(schema.qboEntityMap.oiId, INV_ID)).get();

const invoiceRow = () => db.select().from(schema.invoices)
    .where(eq(schema.invoices.id, INV_ID)).get();

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    queries = [];
    sleeps = [];
    runTimersInline();

    qbo = new QBOService({} as D1Database, 'cid', 'csec', 'whsec', 'a'.repeat(32), 'sandbox');
    invoiceSvc = new InvoiceService({} as D1Database);
    markPaid = vi.fn((id: string, tid: string) => invoiceSvc.markPaid(id, tid, 'qbo'));
    markPartial = vi.fn((id: string, cents: number, tid: string) => invoiceSvc.markPartial(id, tid, 'qbo', cents));

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: CONNECTED_AT,
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-03-01', createdAt: CONNECTED_AT,
    });
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: INSPECTION, amountCents: TOTAL_CENTS,
        lineItems: [{ description: 'Inspection', amountCents: TOTAL_CENTS }],
        sentAt: CONNECTED_AT, createdAt: CONNECTED_AT, currency: 'CAD',
    });
    await db.insert(schema.qboEntityMap).values({
        id: 'map-1', tenantId: TENANT, oiType: 'invoice', oiId: INV_ID,
        qboType: 'Invoice', qboId: QBO_ID, qboSyncToken: '1', syncedAt: CONNECTED_AT,
    });
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: REALM, companyName: 'Sandbox Co',
        accessToken: 'enc:at', refreshToken: 'enc:rt',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        syncEnabled: true, defaultItemId: '1', createdAt: CONNECTED_AT,
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('where the CDC window opens', () => {
    it('asks only for changes since the last successful sweep', async () => {
        await db.update(schema.qboConnections).set({ lastSyncAt: LAST_SYNC_AT })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubPages([[]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries).toHaveLength(1);
        expect(queries[0]).toContain(`MetaData.LastUpdatedTime > '${LAST_SYNC_AT.toISOString()}'`);
    });

    it('falls back to the day the connection was made, not to the epoch', async () => {
        // The first sweep has no previous cursor. `created_at` is the earliest
        // instant this tenant could have had a QuickBooks change worth reading,
        // and it bounds the first page; an epoch fallback would ask a real
        // company for its entire history in pages of 1000.
        expect(connection()!.lastSyncAt).toBeNull();
        stubPages([[]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries[0]).toContain(`MetaData.LastUpdatedTime > '${CONNECTED_AT.toISOString()}'`);
    });

    it('does not poll at all for a paused connection', async () => {
        await db.update(schema.qboConnections).set({ syncEnabled: false })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubPages([[paidInFull()]]);

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 0 });
        expect(queries).toEqual([]);
        // Pausing must not silently move the cursor over the paused window.
        expect(connection()!.lastSyncAt).toBeNull();
    });

    it('does nothing for a tenant with no connection', async () => {
        stubPages([[paidInFull()]]);

        const result = await qbo.runCDCSync(
            '00000000-0000-0000-0000-0000000000ff', markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 0 });
        expect(queries).toEqual([]);
    });
});

describe('paging through a window', () => {
    it('stops after one page when that page is short', async () => {
        stubPages([[paidInFull()]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries).toHaveLength(1);
        expect(queries[0]).toContain('STARTPOSITION 1');
        expect(queries[0]).toContain(`MAXRESULTS ${CDC_PAGE_SIZE}`);
    });

    it('fetches the next page when the first comes back FULL', async () => {
        // A full page means "there may be more" — QuickBooks does not say so.
        // Stopping here is how a busy tenant's sweep silently truncates.
        const full = Array.from({ length: CDC_PAGE_SIZE }, (_, i) => paidInFull(`unmapped-${i}`));
        stubPages([full, [paidInFull('unmapped-last')]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries).toHaveLength(2);
        expect(queries[0]).toContain('STARTPOSITION 1');
        expect(queries[1]).toContain(`STARTPOSITION ${CDC_PAGE_SIZE + 1}`);
        // Both pages sit in the SAME window: the cursor only moves at the end.
        expect(queries[1]).toContain(`MetaData.LastUpdatedTime > '${CONNECTED_AT.toISOString()}'`);
    });
});

describe('what a swept invoice actually does', () => {
    it('applies QuickBooks status through to the invoice and the map row', async () => {
        stubPages([[paidInFull(QBO_ID, '9')]]);

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 1 });
        // The status-application path is what wrote these two rows; asserting
        // the mock's arguments alone would pass against a sweep that called it
        // and threw the result away.
        expect(mapRow()!.qboSyncToken).toBe('9');
        expect(invoiceRow()!.paidAt).not.toBeNull();
        expect(markPaid).toHaveBeenCalledWith(INV_ID, TENANT);
    });

    it('counts only the invoices it could map back to ours', async () => {
        // A tenant's QuickBooks company holds invoices this product never
        // created. They are not failures and must not inflate the count.
        stubPages([[paidInFull('999'), paidInFull(QBO_ID), paidInFull('1000')]]);

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 1 });
        expect(markPaid).toHaveBeenCalledTimes(1);
    });

    it('does not read a voided QuickBooks invoice as payment', async () => {
        // Voiding zeroes the document: `TotalAmt` 0 and `Balance` 0 — the same
        // pair `paidInFull` above reports, which is exactly the problem. Read
        // as settlement it stamped `paid_at` on a $555 invoice against a ledger
        // holding no payment, unlocking the report and counting revenue nobody
        // sent. Observed end to end in the sandbox on 2026-08-16.
        stubPages([[{ Id: QBO_ID, SyncToken: '9', Balance: 0, TotalAmt: 0 } as InvoiceSummary]]);

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 1 });
        expect(markPaid).not.toHaveBeenCalled();
        expect(markPartial).not.toHaveBeenCalled();
        expect(invoiceRow()!.paidAt).toBeNull();
        // ...and the operator finds out, because a void nobody mirrors is a
        // divergence between two sets of books.
        const flags = db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.tenantId, TENANT)).all();
        expect(flags).toHaveLength(1);
        expect(flags[0]!.errorCode).toBe('VOIDED_IN_QBO');
        expect(flags[0]!.oiId).toBe(INV_ID);
        // The SyncToken still advanced: the document was read, just not believed.
        expect(mapRow()!.qboSyncToken).toBe('9');
    });
});

describe('when the cursor is allowed to move', () => {
    it('records the sweep after a successful run', async () => {
        const before = Date.now();
        stubPages([[paidInFull()]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        const lastSyncAt = connection()!.lastSyncAt;
        expect(lastSyncAt).not.toBeNull();
        expect(lastSyncAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('an empty poll is not an error and still moves the cursor forward', async () => {
        // Nothing changed in QuickBooks. Refusing to advance here would make a
        // quiet week replay the same widening window forever.
        stubPages([[]]);

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 0 });
        expect(connection()!.lastSyncAt).not.toBeNull();
    });

    it('leaves the cursor where it was when the run throws partway', async () => {
        // markPaid failing is not caught: the sweep aborts. The window was only
        // half read, so the cursor must still cover it on the next attempt.
        await db.update(schema.qboConnections).set({ lastSyncAt: LAST_SYNC_AT })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubPages([[paidInFull()]]);
        const exploding = vi.fn(async () => { throw new Error('ledger write failed'); });

        await expect(qbo.runCDCSync(TENANT, exploding as never, markPartial as never))
            .rejects.toThrow('ledger write failed');

        expect(connection()!.lastSyncAt!.getTime()).toBe(LAST_SYNC_AT.getTime());
    });

    it('leaves the cursor alone when a page query fails', async () => {
        // The unread window must stay open. Advancing lastSyncAt past invoices we
        // never read closes it forever — those invoices are only re-offered while
        // they still fall inside the window.
        await db.update(schema.qboConnections).set({ lastSyncAt: LAST_SYNC_AT })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubServerError();

        const result = await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(result).toEqual({ processed: 0 });
        expect(queries).toHaveLength(3); // apiCall retried, then gave up.
        expect(connection()!.lastSyncAt!.getTime()).toBe(LAST_SYNC_AT.getTime());
    });

    it('leaves the cursor alone when a LATER page fails, after earlier pages landed', async () => {
        // Failing halfway is the case that decides whether "did the sweep
        // finish" is tracked or merely inferred from having reached the end of
        // the loop. The first page was read and applied; the second was not, so
        // the window still has to cover it.
        await db.update(schema.qboConnections).set({ lastSyncAt: LAST_SYNC_AT })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        const full = Array.from({ length: CDC_PAGE_SIZE }, (_, i) => paidInFull(`unmapped-${i}`));
        let call = 0;
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            queries.push(new URL(String(input)).searchParams.get('query') ?? '');
            if (call++ === 0) {
                return new Response(JSON.stringify({ QueryResponse: { Invoice: full } }), {
                    status: 200, headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ fault: {} }), {
                status: 500, headers: { 'Content-Type': 'application/json' },
            });
        }));

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries.length).toBeGreaterThan(1);
        expect(connection()!.lastSyncAt!.getTime()).toBe(LAST_SYNC_AT.getTime());
    });

    it('survives a 200 whose body is not the documented shape', async () => {
        // Dereferencing QueryResponse outside the try turned a malformed 200
        // into a TypeError, and the caller runs this inside waitUntil where that
        // rejection is unhandled rather than reported.
        await db.update(schema.qboConnections).set({ lastSyncAt: LAST_SYNC_AT })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubMalformedOk();

        await expect(qbo.runCDCSync(TENANT, markPaid as never, markPartial as never))
            .resolves.toEqual({ processed: 0 });
    });
});

describe('where the sweep throttles itself', () => {
    it('waits at the page boundary, not once per invoice', async () => {
        // The API boundary is the page query; the per-invoice loop makes no
        // Intuit calls at all. Sleeping 100ms per row made a single full page
        // block for 100 seconds for nothing. Both numbers are asserted: a page
        // count without a row count would pass on code that never waits.
        const full = Array.from({ length: CDC_PAGE_SIZE }, (_, i) => paidInFull(`unmapped-${i}`));
        stubPages([full, [paidInFull('unmapped-last')]]);

        await qbo.runCDCSync(TENANT, markPaid as never, markPartial as never);

        expect(queries).toHaveLength(2);
        // One wait, between the two page queries — not CDC_PAGE_SIZE + 1 of them.
        expect(sleeps).toHaveLength(1);
    });
});
