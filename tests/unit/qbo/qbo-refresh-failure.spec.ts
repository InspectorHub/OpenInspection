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
});
