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
 *  2. **The duplicate-name ladder.** QuickBooks enforces DisplayName uniqueness
 *     per company. Two different people called "John Smith" is ordinary, so the
 *     create retries with a disambiguated name rather than failing.
 *
 * These specs drive the REAL `apiCall` against a stubbed `fetch`, because the
 * ladder's condition reads the codes inside `err.qboResponse.Fault.Error` — an
 * object `apiCall` builds. Stubbing at the method boundary would mean
 * hand-writing that shape, and a test that invents the shape it asserts on
 * cannot fail when production changes it.
 *
 * Driving the real `apiCall` was still not enough on its own: the fault BODIES
 * here were invented too, and carried a code (`6140`) that the sandbox never
 * returns for this. The ladder passed every spec in this file while having
 * never climbed a real rung. `DUPLICATE_NAME` is now a captured response.
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
/**
 * "Duplicate Name Exists Error" — the one the ladder climbs.
 *
 * Copied verbatim off the wire (sandbox, 2026-08-16) rather than composed from
 * the number the implementation happens to read. It matters: the code is
 * **6240**, and while this helper said `6140` the ladder had never once climbed
 * against the real API — the implementation and this file agreed with each
 * other and with nothing else. A fabricated fault can only test that the code
 * matches itself.
 */
const DUPLICATE_NAME = (): Reply => ({
    status: 400,
    body: {
        Fault: {
            Error: [{
                Message: 'Duplicate Name Exists Error',
                Detail:  'The name supplied already exists. : null',
                code:    '6240',
            }],
            type: 'ValidationFault',
        },
    },
});

/** A QBO customer-query answer. */
const queryFound = (customers: Array<{ Id: string; SyncToken: string; DisplayName: string }>) =>
    ok({ QueryResponse: customers.length ? { Customer: customers } : {} });

// QuickBooks v3 has no PUT: an update is a POST carrying `Id` and `SyncToken`.
// So the verb no longer separates create from update — the BODY does, and that
// is the honest discriminator in production too.
const posts   = () => sent.filter((s) => s.method === 'POST' && !s.body?.Id);
const updates = () => sent.filter((s) => s.method === 'POST' && !!s.body?.Id);
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
    it('POSTs the update with the stored SyncToken and stores the one returned', async () => {
        await seedContactMapping('QBO-CUST-9', '2');
        replies = [ok({ Customer: { Id: 'QBO-CUST-9', SyncToken: '3' } })];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('POST');
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
        expect(sent.map((s) => `${s.method} ${s.endpoint}`)).toEqual(['GET query', 'POST customer']);

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

        expect(updates()[0].body).toMatchObject({
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

    it('stores the SyncToken QuickBooks returned, not the one it was given', async () => {
        // The adoption update is what settles the token: QuickBooks increments it
        // on the write and hands the new value back. Persisting the pre-update
        // value instead leaves the map stale the moment it is created.
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(updates()[0].body.SyncToken).toBe('7');   // sent with what we were told
        expect((await contactMap())?.qboSyncToken).toBe('8');   // kept what came back
    });

    it('so the very next push carries a token QuickBooks still accepts', async () => {
        // Why it matters: unlike `upsertInvoice`, `upsertCustomer` has NO
        // stale-token refetch, so a token that is one behind on arrival cannot
        // be recovered from — the contact would file a sync error on every
        // subsequent push, forever.
        replies = [
            queryFound([{ Id: 'QBO-CUST-55', SyncToken: '7', DisplayName: 'Patricia Client' }]),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '8' } }),
            ok({ Customer: { Id: 'QBO-CUST-55', SyncToken: '9' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);
        await qbo.upsertCustomer(TENANT, PAT);

        expect(updates()).toHaveLength(2);
        expect(updates()[1].body.SyncToken).toBe('8');
        expect(replies).toHaveLength(0);
        expect((await contactMap())?.qboSyncToken).toBe('9');
        expect(await syncErrors()).toHaveLength(0);
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
            oiType: 'contact', oiId: CONTACT, errorCode: 'SYNC_ERROR', resolved: false,
        });
        // The recorded message now carries QuickBooks' own words as well as the
        // status. It used to be the four characters `QBO 400` and nothing more,
        // for every distinct reason a push could be refused.
        expect(errors[0]!.errorMsg).toContain('QBO 400');
        expect(errors[0]!.errorMsg).toContain('6240');
    });

    it('climbs for 6140 as well, not only the code the sandbox returns', async () => {
        // Both numbers mean the same thing to this code path, and pinning only
        // the observed one would make the set look like a single-value check
        // that could be narrowed back without anyone noticing.
        replies = [
            queryFound([]),
            fault(400, '6140', 'Duplicate Name Exists Error'),
            ok({ Customer: { Id: 'QBO-CUST-71', SyncToken: '0' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(displayNames()).toHaveLength(2);
        expect((await contactMap())?.qboId).toBe('QBO-CUST-71');
        expect(await syncErrors()).toHaveLength(0);
    });

    it('climbs when the duplicate is not the first error reported', async () => {
        // One ValidationFault can carry several entries. Reading only `Error[0]`
        // would drop the rung for any response that leads with something else.
        replies = [
            queryFound([]),
            { status: 400, body: { Fault: { type: 'ValidationFault', Error: [
                { Message: 'Business Validation Error', Detail: 'unrelated', code: '6000' },
                { Message: 'Duplicate Name Exists Error', Detail: 'The name supplied already exists. : null', code: '6240' },
            ] } } },
            ok({ Customer: { Id: 'QBO-CUST-72', SyncToken: '0' } }),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect((await contactMap())?.qboId).toBe('QBO-CUST-72');
        expect(await syncErrors()).toHaveLength(0);
    });

    it('does not climb for any other fault code', async () => {
        // The ladder is keyed on the duplicate-name codes specifically.
        // Re-sending a name that was rejected for a different reason cannot
        // help, and each rung is another write attempt against the tenant's
        // books.
        replies = [
            queryFound([]),
            fault(400, '6000', 'A business validation error has occurred'),
        ];

        await qbo.upsertCustomer(TENANT, PAT);

        expect(posts()).toHaveLength(1);
        expect(await contactMap()).toBeUndefined();
        expect(await syncErrors()).toHaveLength(1);
    });

    it('gives every rung a distinct name even when there is no email', async () => {
        // `buildDisplayName` used to need an email for rung 2 and fell through
        // to the contactId form without one, so the ladder was really name →
        // name (contactId) → name (contactId). A third rung that repeats the
        // second cannot do anything the second did not, and must 6140 again:
        // a guaranteed wasted write against the tenant's books.
        replies = [
            DUPLICATE_NAME(), DUPLICATE_NAME(), DUPLICATE_NAME(),
        ];

        await qbo.upsertCustomer(TENANT, { id: CONTACT, name: 'Pat Client' });

        const names = displayNames();
        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);
        expect(names[0]).toBe('Pat Client');
        expect(names[2]).toBe(`Pat Client (${CONTACT})`);
    });
});

// --- the ladder's rungs, read directly -----------------------------------

describe('buildDisplayName', () => {
    it('keeps the email form for rung 2 when there is an email', () => {
        // Positive control. Without it, "the rungs differ" could be satisfied
        // by any change at all — including one that threw the email away.
        expect(qbo.buildDisplayName('Pat', 'Client', 'pat@example.com', 1, CONTACT))
            .toBe('Pat Client (pat@example.com)');
        expect(qbo.buildDisplayName('Pat', 'Client', 'pat@example.com', 0, CONTACT))
            .toBe('Pat Client');
        expect(qbo.buildDisplayName('Pat', 'Client', 'pat@example.com', 2, CONTACT))
            .toBe(`Pat Client (${CONTACT})`);
    });

    it('separates rungs 2 and 3 when there is no email', () => {
        const rung2 = qbo.buildDisplayName('Pat', 'Client', null, 1, CONTACT);
        const rung3 = qbo.buildDisplayName('Pat', 'Client', null, 2, CONTACT);

        expect(rung2).not.toBe(rung3);
        expect(rung3).toBe(`Pat Client (${CONTACT})`);
    });

    it('separates rung 2 between two contacts who share a name', () => {
        // The rungs differing from each other is not the point. Escaping QBO's
        // 6140 duplicate-name error is, and that only happens if two different
        // contacts get two different names. A rung built from a slice of the id
        // that happens to be constant — a shared prefix, say — satisfies the
        // test above and still collides here.
        const a = qbo.buildDisplayName('Pat', 'Client', null, 1, 'contact-aaaa-1111-2222-333333330001');
        const b = qbo.buildDisplayName('Pat', 'Client', null, 1, 'contact-aaaa-1111-2222-333333330002');

        expect(a).not.toBe(b);
    });
});
