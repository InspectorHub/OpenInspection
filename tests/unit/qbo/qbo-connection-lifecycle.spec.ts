/**
 * Connecting, toggling, and disconnecting a QuickBooks company — the four
 * writes that own the connection row and everything hanging off it.
 *
 * Two properties here are worth a test each and are invisible from the call
 * sites. First, the tokens must be at rest as ciphertext: an OAuth refresh
 * token is a standing key to a company's books, and the encryption is deferred
 * to `qbo-crypto` in a way that a refactor could quietly turn into a passthrough
 * with every other test still green. `qbo-crypto` is NOT mocked in this file —
 * its own unit spec covers the algorithm, and what is under test here is that
 * the connection path actually calls it and that the production decrypt path
 * (`getToken`, `revokeToken`) reads the result back.
 *
 * Second, every destructive step is scoped to one tenant. `disconnect` deletes
 * a whole table's worth of rows by tenant id; a missing predicate there wipes
 * every tenant's QuickBooks mapping on a shared deployment, and nothing in the
 * request that triggered it would look wrong. So each delete/update test seeds a
 * SECOND tenant and asserts it survives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase, QBO_REVOKE_URL } from '../../../server/services/qbo/api-base';
import { withConnection } from '../../../server/services/qbo/connection';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789ab';

const ACCESS_PLAIN = 'qbo-access-token-plaintext';
const REFRESH_PLAIN = 'qbo-refresh-token-plaintext';

const T0 = new Date('2026-03-01T10:00:00Z');

class TestQbo extends withConnection(QBOServiceBase) {}

let db: BetterSQLite3Database<typeof schema>;
let svc: TestQbo;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    svc = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', JWT_SECRET, 'sandbox');
});

const connectionOf = (tenantId: string) => db.select().from(schema.qboConnections)
    .where(eq(schema.qboConnections.tenantId, tenantId)).get();

const mapOf = (tenantId: string) => db.select().from(schema.qboEntityMap)
    .where(eq(schema.qboEntityMap.tenantId, tenantId)).all();

async function connect(tenantId: string, over: Partial<Parameters<TestQbo['saveConnection']>[0]> = {}) {
    await svc.saveConnection({
        tenantId,
        realmId:               `realm-${tenantId.slice(-1)}`,
        companyName:           'Acme Books',
        accessToken:           ACCESS_PLAIN,
        refreshToken:          REFRESH_PLAIN,
        refreshTokenExpiresIn: 8_726_400,
        ...over,
    });
}

/** The refresh token as `revokeToken` sent it — the production decrypt path, not a test one. */
function revokedToken(): string | null {
    const call = fetchMock.mock.calls.find(c => c[0] === QBO_REVOKE_URL);
    if (!call) return null;
    return new URLSearchParams(String((call[1] as RequestInit).body)).get('token');
}

describe('saveConnection stores both tokens as ciphertext', () => {
    it('writes neither token in the clear', async () => {
        await connect(TENANT);

        const row = connectionOf(TENANT)!;
        expect(row.accessToken).not.toContain(ACCESS_PLAIN);
        expect(row.refreshToken).not.toContain(REFRESH_PLAIN);
        // The refresh token is the standing key — a passthrough on EITHER column
        // is a plaintext OAuth credential at rest, so both are asserted.
        expect(row.accessToken).not.toBe(ACCESS_PLAIN);
        expect(row.refreshToken).not.toBe(REFRESH_PLAIN);
        expect(row.accessToken).not.toBe(row.refreshToken);
    });

    it('is not a reversible encoding — the same token encrypts differently each time', async () => {
        await connect(TENANT);
        const first = connectionOf(TENANT)!.accessToken;
        await connect(TENANT);
        const second = connectionOf(TENANT)!.accessToken;

        // A random IV per write. Equal ciphertext here would mean base64 or an
        // ECB-shaped scheme snuck in behind the same column name.
        expect(second).not.toBe(first);
    });

    it('round-trips the access token back through getToken', async () => {
        await connect(TENANT);

        // saveConnection dates the access token an hour out, so this reads the
        // stored value rather than triggering a refresh.
        await expect(svc.getToken(TENANT)).resolves.toEqual({
            accessToken: ACCESS_PLAIN, realmId: 'realm-1', tenantId: TENANT,
        });
    });

    it('round-trips the refresh token back through the revoke path', async () => {
        await connect(TENANT);

        await svc.revokeToken(TENANT);

        expect(revokedToken()).toBe(REFRESH_PLAIN);
    });

    it('cannot be read with a different worker secret', async () => {
        await connect(TENANT);
        const wrongKey = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', 'a-different-secret-0123456789abcd', 'sandbox');

        await expect(wrongKey.getToken(TENANT)).rejects.toThrow();
    });

    it('dates both expiries from the connect, in ms', async () => {
        const before = Date.now();
        await connect(TENANT);

        const row = connectionOf(TENANT)!;
        expect(row.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
        expect(row.refreshTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 8_726_400_000);
    });

    it('reconnecting updates the one row and keeps sync switched off if the owner switched it off', async () => {
        await connect(TENANT);
        const createdAt = connectionOf(TENANT)!.createdAt;
        await svc.setSyncEnabled(TENANT);
        expect(connectionOf(TENANT)!.syncEnabled).toBe(false);

        await connect(TENANT, { companyName: 'Acme Books LLC', realmId: 'realm-moved' });

        const rows = db.select().from(schema.qboConnections).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].companyName).toBe('Acme Books LLC');
        expect(rows[0].realmId).toBe('realm-moved');
        // `syncEnabled` and `createdAt` are outside the conflict update on
        // purpose: reconnecting is not consent to resume pushing.
        expect(rows[0].syncEnabled).toBe(false);
        expect(rows[0].createdAt.getTime()).toBe(createdAt.getTime());
    });

    it('keeps one connection per tenant side by side', async () => {
        await connect(TENANT);
        await connect(OTHER);

        expect(db.select().from(schema.qboConnections).all()).toHaveLength(2);
        await expect(svc.getToken(OTHER)).resolves.toMatchObject({ realmId: 'realm-2' });
    });
});

describe('disconnect revokes, clears the mapping, and drops the connection', () => {
    beforeEach(async () => {
        await connect(TENANT);
        await connect(OTHER);
        await svc.linkExistingCustomer(TENANT, 'contact-1', '11');
        await svc.linkExistingCustomer(TENANT, 'contact-2', '12');
        await svc.linkExistingCustomer(OTHER, 'contact-9', '99');
    });

    it('does all three things', async () => {
        await svc.disconnect(TENANT);

        // Revoked at Intuit, with the real refresh token — which also pins the
        // order: revoke reads the row, so it has to happen before the delete.
        expect(revokedToken()).toBe(REFRESH_PLAIN);
        expect(mapOf(TENANT)).toHaveLength(0);
        expect(connectionOf(TENANT)).toBeUndefined();
    });

    it('leaves the other tenant entirely alone', async () => {
        await svc.disconnect(TENANT);

        // The delete is a whole-table sweep filtered only by tenant id. Without
        // that filter every tenant on a shared deployment loses their mapping,
        // and the request that did it looks perfectly ordinary.
        expect(mapOf(OTHER)).toHaveLength(1);
        expect(mapOf(OTHER)[0].qboId).toBe('99');
        expect(connectionOf(OTHER)).toBeTruthy();
        expect(db.select().from(schema.qboEntityMap).all()).toHaveLength(1);
    });

    it('survives Intuit refusing the revoke — the local rows still go', async () => {
        fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));

        await expect(svc.disconnect(TENANT)).resolves.toBeUndefined();

        expect(connectionOf(TENANT)).toBeUndefined();
        expect(mapOf(TENANT)).toHaveLength(0);
    });

    it('is a no-op for a tenant that was never connected', async () => {
        await svc.disconnect('00000000-0000-0000-0000-000000000003');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(db.select().from(schema.qboConnections).all()).toHaveLength(2);
        expect(db.select().from(schema.qboEntityMap).all()).toHaveLength(3);
    });

    it('leaves open sync errors behind — pinned as observed, not endorsed', async () => {
        await db.insert(schema.qboSyncErrors).values({
            id: 'err-1', tenantId: TENANT, oiType: 'invoice', oiId: 'inv-1',
            errorCode: 'SYNC_ERROR', errorMsg: 'QBO 500', retries: 0, resolved: false,
            createdAt: T0, updatedAt: T0,
        });

        await svc.disconnect(TENANT);

        // The rows outlive the connection they describe. Reconnecting shows the
        // new owner errors from a company they are no longer connected to.
        expect(db.select().from(schema.qboSyncErrors).all()).toHaveLength(1);
    });
});

describe('setSyncEnabled toggles the flag and touches nothing else', () => {
    beforeEach(async () => {
        await connect(TENANT);
        await connect(OTHER);
    });

    it('flips the flag and returns the new value', async () => {
        await expect(svc.setSyncEnabled(TENANT)).resolves.toBe(false);
        expect(connectionOf(TENANT)!.syncEnabled).toBe(false);

        await expect(svc.setSyncEnabled(TENANT)).resolves.toBe(true);
        expect(connectionOf(TENANT)!.syncEnabled).toBe(true);
    });

    it('leaves every other column of the row as it was', async () => {
        const before = connectionOf(TENANT)!;

        await svc.setSyncEnabled(TENANT);

        const after = connectionOf(TENANT)!;
        expect({ ...after, syncEnabled: before.syncEnabled }).toEqual(before);
    });

    it('does not touch another tenant\'s switch', async () => {
        await svc.setSyncEnabled(TENANT);

        expect(connectionOf(OTHER)!.syncEnabled).toBe(true);
    });

    it('answers null for a tenant with no connection, and creates nothing', async () => {
        await expect(svc.setSyncEnabled('00000000-0000-0000-0000-000000000003')).resolves.toBeNull();

        expect(db.select().from(schema.qboConnections).all()).toHaveLength(2);
    });
});

describe('resolveError closes one row, for one tenant', () => {
    const errorRow = (id: string, tenantId: string, oiId: string) => ({
        id, tenantId, oiType: 'invoice', oiId,
        errorCode: 'SYNC_ERROR', errorMsg: 'QBO 500', retries: 0, resolved: false,
        createdAt: T0, updatedAt: T0,
    });

    beforeEach(async () => {
        await db.insert(schema.qboSyncErrors).values([
            errorRow('err-a', TENANT, 'inv-a'),
            errorRow('err-b', TENANT, 'inv-b'),
            errorRow('err-other', OTHER, 'inv-c'),
        ]);
    });

    const resolvedIds = () => db.select().from(schema.qboSyncErrors)
        .where(eq(schema.qboSyncErrors.resolved, true)).all().map(r => r.id);

    it('resolves the named row and no sibling', async () => {
        await svc.resolveError(TENANT, 'err-a');

        expect(resolvedIds()).toEqual(['err-a']);
    });

    it('refuses to resolve a row belonging to another tenant', async () => {
        // The error id comes off a page the caller can read; the tenant comes
        // off the JWT. Without the tenant predicate, any id closes any row.
        await svc.resolveError(TENANT, 'err-other');

        expect(resolvedIds()).toEqual([]);
        expect(db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.id, 'err-other')).get()!.resolved).toBe(false);
    });

    it('leaves updatedAt at its old value — pinned as observed, not endorsed', async () => {
        await svc.resolveError(TENANT, 'err-a');

        // clearPaymentDiscrepancy stamps updatedAt when it resolves a row and
        // this path does not, so "when was this closed" is unanswerable here.
        const row = db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.id, 'err-a')).get()!;
        expect(row.updatedAt.getTime()).toBe(T0.getTime());
    });
});

describe('linkExistingCustomer maps a contact onto a QuickBooks customer', () => {
    beforeEach(async () => {
        await connect(TENANT);
        await connect(OTHER);
    });

    const mapping = (tenantId: string, oiId: string) => db.select().from(schema.qboEntityMap)
        .where(and(eq(schema.qboEntityMap.tenantId, tenantId), eq(schema.qboEntityMap.oiId, oiId))).get();

    it('writes the mapping with the QuickBooks-side names Intuit uses', async () => {
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58');

        expect(mapping(TENANT, 'contact-1')).toMatchObject({
            tenantId: TENANT, oiType: 'contact', oiId: 'contact-1',
            qboType: 'Customer', qboId: '58', qboSyncToken: '0',
        });
    });

    it('OVERWRITES an existing mapping for the same contact', async () => {
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58');
        const first = mapping(TENANT, 'contact-1')!;

        await svc.linkExistingCustomer(TENANT, 'contact-1', '59');

        const second = mapping(TENANT, 'contact-1')!;
        expect(db.select().from(schema.qboEntityMap).all()).toHaveLength(1);
        expect(second.id).toBe(first.id);
        expect(second.qboId).toBe('59');
        // Pinned as observed, not endorsed: the sync token is NOT reset by the
        // overwrite. It is QuickBooks' optimistic-concurrency counter for the
        // OLD customer, so after a relink it describes an entity this row no
        // longer points at, and the next update sends a token from elsewhere.
        expect(second.qboSyncToken).toBe('0');
    });

    it('keeps a stale sync token when the mapping is repointed', async () => {
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58');
        // Stand in for a sync having happened against customer 58.
        await db.update(schema.qboEntityMap).set({ qboSyncToken: '7' })
            .where(eq(schema.qboEntityMap.oiId, 'contact-1'));

        await svc.linkExistingCustomer(TENANT, 'contact-1', '59');

        expect(mapping(TENANT, 'contact-1')!.qboSyncToken).toBe('7');
    });

    it('REFUSES to point a second contact at a customer already claimed', async () => {
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58');

        // The reverse unique key (tenant, qboType, qboId) is not the conflict
        // target, so this surfaces as a raw constraint violation rather than a
        // handled answer. Pinned as observed: the guard exists, its wording
        // reaches the operator as a 500.
        await expect(svc.linkExistingCustomer(TENANT, 'contact-2', '58')).rejects.toThrow(/UNIQUE/i);
        expect(db.select().from(schema.qboEntityMap).all()).toHaveLength(1);
    });

    it('is scoped to the tenant — the same contact id in another tenant is a separate mapping', async () => {
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58');
        await svc.linkExistingCustomer(OTHER, 'contact-1', '99');

        expect(mapping(TENANT, 'contact-1')!.qboId).toBe('58');
        expect(mapping(OTHER, 'contact-1')!.qboId).toBe('99');

        await svc.linkExistingCustomer(TENANT, 'contact-1', '60');
        expect(mapping(OTHER, 'contact-1')!.qboId).toBe('99');
    });
});
