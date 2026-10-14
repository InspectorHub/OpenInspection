/**
 * Looking up QuickBooks customers so a contact can be matched to one by hand.
 *
 * The query text is built from what a person typed, and it is sent to Intuit
 * under this company's credentials, so the ways it can go wrong are tested with
 * a positive control beside each refusal:
 *
 *  - the typed text is escaped (quote, backslash, `%`, `_`) and bounded, so it
 *    cannot widen or break the query;
 *  - only active customers are asked for;
 *  - the rows handed back carry no SyncToken and no raw Intuit object;
 *  - each row says whether a contact of THIS company already holds it, and who;
 *    another company's holder of the same QuickBooks id never shows;
 *  - a throttled, unreachable or disconnected QuickBooks reads as one of the
 *    stable reasons the match flow already uses, never as Intuit's own Fault body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withConnection } from '../../../server/services/qbo/connection';
import {
    withCustomerSearch, escapeQboLike, buildCustomerSearchQuery,
} from '../../../server/services/qbo/customer-search';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const T0 = new Date('2026-03-01T10:00:00Z');

class TestQbo extends withCustomerSearch(withConnection(QBOServiceBase)) {}

describe('escapeQboLike', () => {
    it('escapes a quote, a backslash and the two wildcards', () => {
        expect(escapeQboLike("O'Brien")).toBe("O\\'Brien");
        expect(escapeQboLike('a%b_c')).toBe('a\\%b\\_c');
        expect(escapeQboLike('a\\b')).toBe('a\\\\b');
    });

    it('escapes all four together, in one pass, without doubling a backslash it just added', () => {
        // a % b _ c \ d ' e   ->   each of the four gets exactly one backslash in front.
        expect(escapeQboLike("a%b_c\\d'e")).toBe("a\\%b\\_c\\\\d\\'e");
        // A backslash followed by a wildcard: the backslash is escaped, the wildcard too.
        expect(escapeQboLike('\\%')).toBe('\\\\\\%');
    });

    it('lets an ordinary name through untouched (positive control)', () => {
        expect(escapeQboLike('Alice Adams')).toBe('Alice Adams');
    });
});

describe('buildCustomerSearchQuery', () => {
    it('asks for active customers by display name, ordered, with the paging window', () => {
        expect(buildCustomerSearchQuery('smith', 1, 20)).toBe(
            'SELECT Id, DisplayName, CompanyName, PrimaryEmailAddr, PrimaryPhone, Active FROM Customer '
            + "WHERE Active = true AND DisplayName LIKE '%smith%' ORDERBY DisplayName STARTPOSITION 1 MAXRESULTS 20",
        );
    });

    it('clamps the window: at most 20 rows, never before position 1', () => {
        const clamped = buildCustomerSearchQuery('smith', 0, 500);
        expect(clamped).toContain('STARTPOSITION 1 MAXRESULTS 20');
        expect(buildCustomerSearchQuery('smith', 41, 5)).toContain('STARTPOSITION 41 MAXRESULTS 5');
        expect(buildCustomerSearchQuery('smith', 1, 0)).toContain('MAXRESULTS 1');
    });

    it('keeps typed text inside the quoted literal', () => {
        const query = buildCustomerSearchQuery("x' OR Active = false OR DisplayName LIKE '", 1, 20);
        expect(query).toContain("LIKE '%x\\' OR Active = false OR DisplayName LIKE \\'%'");
        expect(query.match(/Active = true/g)).toHaveLength(1);
    });

    it('looks an address up by exact email instead of by name', () => {
        const query = buildCustomerSearchQuery("o'brien@example.com", 1, 20);
        expect(query).toContain("Active = true AND PrimaryEmailAddr = 'o\\'brien@example.com'");
        expect(query).not.toContain('DisplayName LIKE');
    });
});

let db: BetterSQLite3Database<typeof schema>;
let svc: TestQbo;
let querySpy: ReturnType<typeof vi.spyOn>;

const qboRow = (id: string, extra: Record<string, unknown> = {}) => ({
    Id: id, SyncToken: '7', DisplayName: `Customer ${id}`, CompanyName: `Co ${id}`,
    PrimaryEmailAddr: { Address: `c${id}@example.com` }, PrimaryPhone: { FreeFormNumber: '555-0100' },
    Active: true, Balance: 12.5, ...extra,
});

const reply = (rows: unknown[]) => querySpy.mockResolvedValue({ QueryResponse: { Customer: rows } });

async function thrownBy(run: () => Promise<unknown>): Promise<AppError> {
    try {
        await run();
    } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        return err as AppError;
    }
    throw new Error('expected the call to throw');
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    svc = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', 'unit-test-jwt-secret-0123456789ab', 'sandbox');
    querySpy = vi.spyOn(svc as unknown as { qboQuery: (...a: unknown[]) => Promise<unknown> }, 'qboQuery');

    for (const [id, slug] of [[TENANT, 'acme'], [OTHER, 'other']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: T0,
        });
    }
    const contact = (id: string, tenantId: string, name: string) =>
        db.insert(schema.contacts).values({
            id, tenantId, type: 'client', name, email: `${id}@example.com`, createdAt: T0,
        } as never);
    await contact('contact-1', TENANT, 'Alice Adams');
    await contact('contact-foreign', OTHER, 'Foreign Person');
});

describe('searchCustomers shapes what it hands back', () => {
    it('maps the fields the picker shows and leaves out the SyncToken and everything else', async () => {
        reply([qboRow('58')]);

        const out = await svc.searchCustomers(TENANT, 'cust', 1, 20);

        expect(out.customers).toEqual([{
            id: '58', displayName: 'Customer 58', companyName: 'Co 58', email: 'c58@example.com',
            phone: '555-0100', active: true, linkedContactId: null, linkedContactName: null,
        }]);
        const wire = JSON.stringify(out);
        expect(wire).not.toContain('SyncToken');
        expect(wire).not.toContain('Balance');
        // Positive control: the stubbed Intuit row really did carry both.
        expect(JSON.stringify(qboRow('58'))).toContain('SyncToken');
    });

    it('turns missing optional fields into null, not undefined', async () => {
        reply([{ Id: '59', DisplayName: 'Bare' }]);

        const [row] = (await svc.searchCustomers(TENANT, 'bare', 1, 20)).customers;

        expect(row).toMatchObject({ companyName: null, email: null, phone: null });
    });

    it('answers an empty list when Intuit has no Customer array', async () => {
        querySpy.mockResolvedValue({ QueryResponse: {} });

        const out = await svc.searchCustomers(TENANT, 'nobody', 1, 20);

        expect(out).toEqual({ customers: [], nextStartPosition: null });
    });

    it('sends the built query, so the escaping above is what reaches Intuit', async () => {
        reply([]);

        await svc.searchCustomers(TENANT, "O'Brien", 1, 20);

        expect(querySpy).toHaveBeenCalledWith(TENANT, buildCustomerSearchQuery("O'Brien", 1, 20));
    });
});

describe('searchCustomers marks customers a contact of this company already holds', () => {
    const hold = (tenantId: string, contactId: string, qboId: string) =>
        db.insert(schema.qboEntityMap).values({
            id: `map-${tenantId}-${qboId}`, tenantId, oiType: 'contact', oiId: contactId,
            qboType: 'Customer', qboId, qboSyncToken: '0', syncedAt: T0,
        }).run();

    it('names the holder', async () => {
        await hold(TENANT, 'contact-1', '58');
        reply([qboRow('58'), qboRow('60')]);

        const rows = (await svc.searchCustomers(TENANT, 'cust', 1, 20)).customers;

        expect(rows.find((r) => r.id === '58')).toMatchObject({
            linkedContactId: 'contact-1', linkedContactName: 'Alice Adams',
        });
        // Positive control: a customer nobody holds stays unmarked.
        expect(rows.find((r) => r.id === '60')).toMatchObject({ linkedContactId: null, linkedContactName: null });
    });

    it('does not show another company\'s holder of the same QuickBooks id', async () => {
        await hold(OTHER, 'contact-foreign', '58');
        reply([qboRow('58')]);

        const [row] = (await svc.searchCustomers(TENANT, 'cust', 1, 20)).customers;

        expect(row).toMatchObject({ linkedContactId: null, linkedContactName: null });
        expect(JSON.stringify(row)).not.toContain('Foreign Person');
    });
});

describe('searchCustomers paging', () => {
    it('offers the next window when the page came back full', async () => {
        reply([qboRow('1'), qboRow('2')]);

        expect((await svc.searchCustomers(TENANT, 'cust', 3, 2)).nextStartPosition).toBe(5);
    });

    it('stops when the page came back short (positive control)', async () => {
        reply([qboRow('1')]);

        expect((await svc.searchCustomers(TENANT, 'cust', 3, 2)).nextStartPosition).toBeNull();
    });
});

describe('searchCustomers tells the caller what went wrong with QuickBooks', () => {
    const failWith = (status: number | undefined, message = `QBO ${status}`) =>
        querySpy.mockRejectedValue(Object.assign(new Error(message), {
            status, qboResponse: { Fault: { Error: [{ Message: 'internal intuit detail' }] } },
        }));

    it('maps a throttled or failing QuickBooks to qbo_unavailable (503)', async () => {
        failWith(429);
        const throttled = await thrownBy(() => svc.searchCustomers(TENANT, 'cust', 1, 20));
        failWith(502);
        const broken = await thrownBy(() => svc.searchCustomers(TENANT, 'cust', 1, 20));

        for (const err of [throttled, broken]) {
            expect(err.status).toBe(503);
            expect(err.details).toMatchObject({ reason: 'qbo_unavailable' });
        }
    });

    it('maps a missing connection or a rejected token to qbo_not_connected (409)', async () => {
        failWith(undefined, 'No QBO connection for tenant x');
        const missing = await thrownBy(() => svc.searchCustomers(TENANT, 'cust', 1, 20));
        failWith(401);
        const rejected = await thrownBy(() => svc.searchCustomers(TENANT, 'cust', 1, 20));

        for (const err of [missing, rejected]) {
            expect(err.status).toBe(409);
            expect(err.details).toMatchObject({ reason: 'qbo_not_connected' });
        }
    });

    it('maps a query Intuit refuses to a plain 400 without passing its Fault on', async () => {
        failWith(400);

        const err = await thrownBy(() => svc.searchCustomers(TENANT, 'cust', 1, 20));

        expect(err.status).toBe(400);
        expect(err.details).toMatchObject({ reason: 'qbo_search_rejected' });
        expect(JSON.stringify({ message: err.message, details: err.details })).not.toContain('internal intuit detail');
    });

    it('lets the same call succeed when QuickBooks is healthy (positive control)', async () => {
        reply([qboRow('58')]);

        await expect(svc.searchCustomers(TENANT, 'cust', 1, 20)).resolves.toBeTruthy();
    });
});
