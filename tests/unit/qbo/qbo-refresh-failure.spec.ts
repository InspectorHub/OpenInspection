/**
 * A transient failure must not disconnect a paying customer.
 *
 * Intuit rotates the refresh token every 24-26 hours, so `refreshToken` runs on
 * every connected tenant, every day, forever. It used to treat ANY non-2xx from
 * the token endpoint as "reauthorize required" and DELETE the connection row —
 * meaning a single Intuit 5xx, or a rate limit, permanently severed the
 * integration and forced an owner back through the whole OAuth flow, with no
 * record of why. The tenant's books stop syncing in the meantime, silently.
 *
 * Only an explicit refusal of the grant is terminal. Intuit answers a dead or
 * already-rotated refresh token with 400 (`invalid_grant`) or 401; everything
 * else — 429, 5xx, a network error — says nothing about the token's validity
 * and must leave it alone so the next attempt can use it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { QBOServiceBase } from '../../../server/services/qbo/api-base';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Exposes the protected refresh so the real decision is what is under test. */
class TestQbo extends QBOServiceBase {
    refresh(tenantId: string) { return this.refreshToken(tenantId); }
}

function respond(status: number, body: unknown = { error: 'x' }) {
    return vi.fn(async () => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
    }));
}

describe('QBO refresh-token failure handling', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: TestQbo;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.qboConnections).values({
            tenantId:              TENANT,
            realmId:               '9130350000000000',
            companyName:           'Sandbox Co',
            accessToken:           'enc:at',
            refreshToken:          'enc:rt',
            tokenExpiresAt:        new Date(Date.now() - 1000),
            refreshTokenExpiresAt: new Date(Date.now() + 86_400_000 * 100),
            syncEnabled:           true,
            defaultItemId:         '1',
            createdAt:             new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new TestQbo({} as any, 'cid', 'csec', 'whsec', 'a'.repeat(32), 'sandbox');
    });

    const connectionRow = () =>
        db.select().from(schema.qboConnections).where(eq(schema.qboConnections.tenantId, TENANT)).get();

    it('KEEPS the connection when Intuit returns 500', async () => {
        vi.stubGlobal('fetch', respond(500));
        await expect(svc.refresh(TENANT)).rejects.toThrow();
        // The refresh token is untouched and still usable on the next attempt.
        expect(connectionRow()).toBeTruthy();
        expect(connectionRow()!.refreshToken).toBe('enc:rt');
        vi.unstubAllGlobals();
    });

    it('KEEPS the connection when Intuit rate-limits (429)', async () => {
        vi.stubGlobal('fetch', respond(429));
        await expect(svc.refresh(TENANT)).rejects.toThrow();
        expect(connectionRow()).toBeTruthy();
        vi.unstubAllGlobals();
    });

    it('KEEPS the connection when the network fails outright', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
        await expect(svc.refresh(TENANT)).rejects.toThrow();
        expect(connectionRow()).toBeTruthy();
        vi.unstubAllGlobals();
    });

    it('DELETES the connection on 400 invalid_grant — the token is genuinely dead', async () => {
        vi.stubGlobal('fetch', respond(400, { error: 'invalid_grant' }));
        await expect(svc.refresh(TENANT)).rejects.toThrow(/reconnect/i);
        expect(connectionRow()).toBeUndefined();
        vi.unstubAllGlobals();
    });

    it('DELETES the connection on 401', async () => {
        vi.stubGlobal('fetch', respond(401));
        await expect(svc.refresh(TENANT)).rejects.toThrow(/reconnect/i);
        expect(connectionRow()).toBeUndefined();
        vi.unstubAllGlobals();
    });

    /**
     * A grant refused by Intuit retires the connection just as surely as a
     * tenant clicking Disconnect. The two paths must therefore leave the same
     * thing behind — nothing — and they used to disagree: `disconnect()` clears
     * the mappings and the open errors, while this path dropped only the
     * connection row.
     *
     * What that costs is not tidiness. The next authorization can land on a
     * DIFFERENT QuickBooks company, and a surviving mapping still names entity
     * ids belonging to the old one. The first invoice push then addresses a
     * customer id in books we are no longer connected to.
     */
    describe('what a refused grant leaves behind', () => {
        const mapRows = () =>
            db.select().from(schema.qboEntityMap).where(eq(schema.qboEntityMap.tenantId, TENANT)).all();
        const errorRows = () =>
            db.select().from(schema.qboSyncErrors).where(eq(schema.qboSyncErrors.tenantId, TENANT)).all();

        beforeEach(async () => {
            await db.insert(schema.qboEntityMap).values({
                id: 'map-1', tenantId: TENANT,
                oiType: 'contact', oiId: 'contact-1',
                qboType: 'Customer', qboId: '58',
                qboSyncToken: '0', syncedAt: new Date(),
            });
            await db.insert(schema.qboSyncErrors).values({
                id: 'err-1', tenantId: TENANT,
                oiType: 'invoice', oiId: 'inv-1',
                errorCode: 'SYNC_ERROR', errorMsg: 'boom',
                retries: 0, resolved: false,
                createdAt: new Date(), updatedAt: new Date(),
            });
        });

        it('leaves no entity mappings pointing at a company we no longer hold', async () => {
            vi.stubGlobal('fetch', respond(400, { error: 'invalid_grant' }));
            await expect(svc.refresh(TENANT)).rejects.toThrow(/reconnect/i);
            expect(mapRows()).toHaveLength(0);
            vi.unstubAllGlobals();
        });

        it('leaves no open errors describing a connection that is gone', async () => {
            vi.stubGlobal('fetch', respond(401));
            await expect(svc.refresh(TENANT)).rejects.toThrow(/reconnect/i);
            expect(errorRows()).toHaveLength(0);
            vi.unstubAllGlobals();
        });

        it('keeps all of it when Intuit merely had an outage', async () => {
            // The positive control, and the reason this cleanup cannot simply be
            // hoisted above the status check: a 500 says nothing about the grant,
            // and wiping the mappings there would turn every Intuit blip into a
            // full resync of the tenant's books.
            vi.stubGlobal('fetch', respond(500));
            await expect(svc.refresh(TENANT)).rejects.toThrow();
            expect(connectionRow()).toBeTruthy();
            expect(mapRows()).toHaveLength(1);
            expect(errorRows()).toHaveLength(1);
            vi.unstubAllGlobals();
        });
    });
});
