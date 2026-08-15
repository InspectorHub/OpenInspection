/**
 * `upsertCustomer` — the push that gives a contact a QuickBooks twin.
 *
 * Nothing else in the QBO suite reached it, and it is the function every other
 * push depends on: the invoice push reads its `qbo_entity_map` row for
 * `CustomerRef`, and both `recordPayment` and `createCreditMemo` refuse to post
 * at all without one. A contact that fails to map silently disables three
 * downstream pushes.
 *
 * Two things it does that nothing else in this service does:
 *
 *  1. **Adoption.** A tenant who already keeps this client in QuickBooks must
 *     not get a second Customer — duplicates split one person's receivables in
 *     two. So an unmapped contact with an email is looked up first, and a match
 *     is adopted into the map rather than created.
 *  2. **The 6140 ladder.** QuickBooks enforces DisplayName uniqueness per
 *     company. Two different people called "John Smith" is ordinary, so the
 *     create retries with a disambiguated name rather than failing.
 *
 * These specs drive the REAL `apiCall` against a stubbed `fetch`, because the
 * ladder's condition reads `err.qboResponse.Fault.Error[0].code` — an object
 * `apiCall` builds. Stubbing at the method boundary would mean hand-writing
 * that shape, and a test that invents the shape it asserts on cannot fail when
 * production changes it.
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
import { withCustomerSync } from '../../../server/services/qbo/customer-sync';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CONTACT = 'contact-aaaa-0000-0000-000000000001';
const REALM = 'realm-1';

const T0 = new Date('2026-03-01T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date(Date.now() + 24 * 3_600_000);

class TestQbo extends withCustomerSync(QBOServiceBase) {}

const PAT = {
    id:     CONTACT,
    name:   'Pat Client',
    email:  'pat@example.com',
    phone:  '555-0100',
    agency: 'Oak Realty',
};

// --- the wire ------------------------------------------------------------

interface Sent { method: string; endpoint: string; url: string; body: any }
type Reply = { status: number; body: unknown };

let sent: Sent[] = [];
let replies: Reply[] = [];

const ok = (body: unknown): Reply => ({ status: 200, body });
const fault = (status: number, code: string, message: string): Reply => ({
    status,
    body: { Fault: { Error: [{ code, Message: message, Detail: message }], type: 'ValidationFault' } },
});
/** "Duplicate Name Exists Error" — the one the ladder climbs. */
const DUPLICATE_NAME = () => fault(400, '6140', 'Duplicate Name Exists Error');

/** A QBO customer-query answer. */
const queryFound = (customers: Array<{ Id: string; SyncToken: string; DisplayName: string }>) =>
    ok({ QueryResponse: customers.length ? { Customer: customers } : {} });

const posts = () => sent.filter((s) => s.method === 'POST');
const puts = () => sent.filter((s) => s.method === 'PUT');
const displayNames = () => posts().map((p) => p.body.DisplayName);

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
        if (!reply) throw new Error(`unplanned QBO call: ${init?.method ?? 'GET'} ${url}`);
        return new Response(JSON.stringify(reply.body), {
            status: reply.status, headers: { 'content-type': 'application/json' },
        });
    }));
}

// --- fixtures ------------------------------------------------------------

let db: BetterSQLite3Database<typeof schema>;
let qbo: TestQbo;

const contactMap = () => db.select().from(schema.qboEntityMap)
    .where(and(
        eq(schema.qboEntityMap.tenantId, TENANT),
        eq(schema.qboEntityMap.oiType, 'contact'),
        eq(schema.qboEntityMap.oiId, CONTACT),
    )).get();

const allMaps = () => db.select().from(schema.qboEntityMap).all();

const syncErrors = () => db.select().from(schema.qboSyncErrors)
    .where(eq(schema.qboSyncErrors.tenantId, TENANT)).all();

async function seedContactMapping(qboId: string, syncToken: string) {
    await db.insert(schema.qboEntityMap).values({
        id: 'map-contact', tenantId: TENANT, oiType: 'contact', oiId: CONTACT,
        qboType: 'Customer', qboId, qboSyncToken: syncToken, syncedAt: T0,
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
    await db.insert(schema.contacts).values({
        id: CONTACT, tenantId: TENANT, type: 'client', name: 'Pat Client',
        email: 'pat@example.com', createdAt: T0,
    } as never);
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: REALM, accessToken: 'enc:access', refreshToken: 'enc:refresh',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        defaultItemId: 'ITEM-7', createdAt: T0,
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

// --- already mapped ------------------------------------------------------

describe('a contact that already has a QuickBooks twin', () => {
    it('PUTs with the stored SyncToken and stores the one returned', async () => {
        await seedContactMapping('QBO-CUST-9', '2');
        replies = [ok({ Customer: { Id: 'QBO-CUST-9', SyncToken: '3' } })];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('PUT');
        expect(sent[0].endpoint).toBe('customer');
        expect(sent[0].body).toMatchObject({ Id: 'QBO-CUST-9', SyncToken: '2' });

        const row = await contactMap();
        expect(row?.qboSyncToken).toBe('3');
        expect(row?.syncedAt.getTime()).toBeGreaterThan(T0.getTime());
    });

    it('never looks for a duplicate and never creates one', async () => {
        // The email query is the expensive, ambiguous step. A mapped contact has
        // already answered the question it asks.
        await seedContactMapping('QBO-CUST-9', '2');
        replies = [ok({ Customer: { Id: 'QBO-CUST-9', SyncToken: '3' } })];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(posts()).toHaveLength(0);
        expect(sent.filter((s) => s.endpoint === 'query')).toHaveLength(0);
        expect(await allMaps()).toHaveLength(1);
    });

    it('carries the contact fields QuickBooks keeps', async () => {
        await seedContactMapping('QBO-CUST-9', '2');
        replies = [ok({ Customer: { Id: 'QBO-CUST-9', SyncToken: '3' } })];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(sent[0].body).toMatchObject({
            DisplayName:      'Pat Client',
            GivenName:        'Pat',
            FamilyName:       'Client',
            CompanyName:      'Oak Realty',
            PrimaryEmailAddr: { Address: 'pat@example.com' },
            PrimaryPhone:     { FreeFormNumber: '555-0100' },
        });
    });
});

// --- adoption ------------------------------------------------------------

describe('an unmapped contact QuickBooks already knows by email', () => {
    it('adopts the existing customer instead of creating a duplicate', async () => {
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        // No POST anywhere: a second Customer would split this person's
        // receivables across two rows in the tenant's books.
        expect(posts()).toHaveLength(0);
        expect(sent.map((s) => `${s.method} ${s.endpoint}`)).toEqual(['GET query', 'PUT customer']);

        const row = await contactMap();
        expect(row).toMatchObject({ qboType: 'Customer', qboId: 'QBO-CUST-55' });
    });

    it('asks QuickBooks by the email address, not by name', async () => {
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        const query = new URL(sent[0].url).searchParams.get('query');
        expect(query).toBe("SELECT * FROM Customer WHERE PrimaryEmailAddr = 'pat@example.com' MAXRESULTS 5");
    });

    it("updates the adopted customer under ITS DisplayName, not ours", async () => {
        // The adopted row is the tenant's own record of this person. Renaming it
        // to our spelling on adoption would rewrite a name they chose, and could
        // itself collide with another customer of theirs.
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(puts()[0].body).toMatchObject({
            Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client',
        });
    });

    it('takes the first of several matches', async () => {
        // Several customers on one address is genuinely ambiguous; the code
        // picks the first and logs. Pinned so a future dedupe rule is a
        // deliberate change rather than a silent one.
        replies = [
            queryFound([
                { Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' },
                { Id: 'QBO-CUST-56', SyncToken: '1', DisplayName: 'P. Client' },
            ]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect((await contactMap())?.qboId).toBe('QBO-CUST-55');
        expect(await allMaps()).toHaveLength(1);
    });

    it('SUSPECTED DEFECT: stores the pre-update SyncToken, so the map is stale on arrival', async () => {
        // The adoption PUT returns SyncToken '8' and the map keeps '7' — the
        // response is never read. Every other write site in this service stores
        // the token the call handed back.
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect((await contactMap())?.qboSyncToken).toBe('7');
    });

    it('SUSPECTED DEFECT: the very next push therefore fails on a stale token', async () => {
        // The consequence of the row above, and why it matters: unlike
        // `upsertInvoice`, `upsertCustomer` has NO stale-token refetch, so the
        // push after an adoption cannot recover — it files a sync error and
        // leaves the contact permanently one token behind.
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
            fault(400, '5010', 'Stale Object Error'),
        ];

        await qbo.upsertCustomer(TENANT, PAT);
        await qbo.upsertCustomer(TENANT, PAT);

        expect(puts()).toHaveLength(2);
        expect(puts()[1].body.SyncToken).toBe('7');
        expect(replies).toHaveLength(0);           // no refetch, no retry
        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ oiType: 'contact', oiId: CONTACT, errorCode: 'SYNC_ERROR' });
    });

    it('falls through to creating when the email matches nothing', async () => {
        replies = [
            queryFound([]),
            ok({ Customer: { Id: 'QBO-CUST-70', SyncToken: '0' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(sent.map((s) => `${s.method} ${s.endpoint}`)).toEqual(['GET query', 'POST customer']);
        expect((await contactMap())?.qboId).toBe('QBO-CUST-70');
    });

    it('skips the lookup entirely for a contact with no email', async () => {
        replies = [ok({ Customer: { Id: 'QBO-CUST-70', SyncToken: '0' } })];

        await qbo.upsertCustomer(TENANT, { id: CONTACT, name: 'Pat Client' });

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('POST');
    });
});

// --- creating ------------------------------------------------------------

describe('creating a new QuickBooks customer', () => {
    it('records the id and SyncToken it was given', async () => {
        replies = [
            queryFound([]),
            ok({ Customer: { Id: 'QBO-CUST-70', SyncToken: '0' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        const row = await contactMap();
        expect(row).toMatchObject({
            tenantId: TENANT, oiType: 'contact', oiId: CONTACT,
            qboType: 'Customer', qboId: 'QBO-CUST-70', qboSyncToken: '0',
        });
        expect(await syncErrors()).toHaveLength(0);
    });
});

// --- the 6140 duplicate-name ladder --------------------------------------

describe('the duplicate-name ladder', () => {
    it('climbs name → name (email) → name (contactId), in that order', async () => {
        // Two different people called Pat Client is ordinary. QuickBooks enforces
        // DisplayName uniqueness per company, so the create disambiguates rather
        // than failing and leaving the contact unmapped.
        replies = [
            queryFound([]),
            DUPLICATE_NAME(),
            DUPLICATE_NAME(),
            ok({ Customer: { Id: 'QBO-CUST-70', SyncToken: '0' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(displayNames()).toEqual([
            'Pat Client',
            'Pat Client (pat@example.com)',
            `Pat Client (${CONTACT})`,
        ]);
        // And the rung that worked is the one that got recorded.
        expect((await contactMap())?.qboId).toBe('QBO-CUST-70');
        expect(await syncErrors()).toHaveLength(0);
    });

    it('stops after the third rung instead of climbing forever', async () => {
        replies = [
            queryFound([]),
            DUPLICATE_NAME(), DUPLICATE_NAME(), DUPLICATE_NAME(),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(posts()).toHaveLength(3);
        expect(replies).toHaveLength(0);   // a fourth attempt throws out of the stub
        // Nothing was created, so nothing is mapped — and the failure is filed
        // rather than swallowed, because a contact with no twin silently
        // disables the invoice, payment and credit-memo pushes behind it.
        expect(await contactMap()).toBeUndefined();
        const errors = await syncErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            oiType: 'contact', oiId: CONTACT, errorCode: 'SYNC_ERROR',
            errorMsg: 'QBO 400', resolved: false,
        });
    });

    it('does not climb for any other fault code', async () => {
        // The ladder is keyed on 6140 specifically. Re-sending a name that was
        // rejected for a different reason cannot help, and each rung is another
        // write attempt against the tenant's books.
        replies = [
            queryFound([]),
            fault(400, '6000', 'A business validation error has occurred'),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(posts()).toHaveLength(1);
        expect(await contactMap()).toBeUndefined();
        expect(await syncErrors()).toHaveLength(1);
    });

    it('SUSPECTED DEFECT: with no email, rungs 2 and 3 send the identical name', async () => {
        // `buildDisplayName` needs an email for rung 2 and falls through to the
        // contactId form without one, so the ladder is really name →
        // name (contactId) → name (contactId). The third rung cannot do anything
        // the second did not, and must 6140 again: a guaranteed wasted write.
        replies = [
            DUPLICATE_NAME(), DUPLICATE_NAME(), DUPLICATE_NAME(),
        ];

        await qbo.upsertCustomer(TENANT, { id: CONTACT, name: 'Pat Client' });

        expect(displayNames()).toEqual([
            'Pat Client',
            `Pat Client (${CONTACT})`,
            `Pat Client (${CONTACT})`,
        ]);
    });
});
