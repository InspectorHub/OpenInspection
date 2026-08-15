/**
 * The QuickBooks transport loop: how many times a call is attempted, how long
 * it waits between attempts, and what a caller is handed when it gives up.
 *
 * `apiCall` is the single door every QuickBooks read and write goes through, so
 * its retry policy decides whether an Intuit blip is invisible or is a failed
 * sync a tenant has to look at. Two of the numbers in it are load-bearing and
 * neither is obvious from the call sites: the attempt count (3 — a fourth would
 * multiply an outage, a second would surface one), and the fact that a 429
 * waits the interval INTUIT NAMED rather than our own backoff, because ignoring
 * `Retry-After` is how a rate limit becomes a ban.
 *
 * The clock is faked here. Left real, the all-5xx case alone sleeps 3 seconds
 * and the default-`Retry-After` case sleeps 183, which is the kind of test that
 * gets deleted rather than fixed. Only `setTimeout`/`clearTimeout`/`Date` are
 * faked — `setImmediate` is left alone so `Response.json()` still settles.
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
import { QBOServiceBase } from '../../../server/services/qbo/api-base';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REALM = '9130350000000000';
const NOW = new Date('2026-08-14T12:00:00.000Z');

/** An access token that is nowhere near expiry, so `apiCall` spends no fetch on a refresh. */
const FAR = 3_600_000;

type QboError = Error & { status?: number; qboResponse?: unknown };

function jsonResponse(status: number, body: unknown = { fault: 'x' }, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

let db: BetterSQLite3Database<typeof schema>;
let svc: QBOServiceBase;

async function seedConnection(tokenTtlMs: number) {
    await db.insert(schema.qboConnections).values({
        tenantId:              TENANT,
        realmId:               REALM,
        companyName:           'Sandbox Co',
        accessToken:           'enc:at',
        refreshToken:          'enc:rt',
        tokenExpiresAt:        new Date(Date.now() + tokenTtlMs),
        refreshTokenExpiresAt: new Date(Date.now() + 8_640_000_000),
        syncEnabled:           true,
        defaultItemId:         '1',
        createdAt:             new Date(),
    });
}

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);

    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    svc = new QBOServiceBase({} as D1Database, 'cid', 'csec', 'whsec', 'a'.repeat(32), 'sandbox');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** Starts the call and swallows the rejection immediately, so advancing the clock is safe. */
function start<T>(promise: Promise<T>): Promise<T | QboError> {
    return promise.catch((e: QboError) => e);
}

describe('apiCall retries a server-side failure exactly three times', () => {
    beforeEach(() => seedConnection(FAR));

    it('attempts a 5xx three times and no more', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(500));
        vi.stubGlobal('fetch', fetchMock);

        const call = start(svc.apiCall(TENANT, 'GET', 'invoice/1'));
        await vi.advanceTimersByTimeAsync(60_000);
        const err = await call as QboError;

        // Three attempts, not "more than one": a fourth would multiply an
        // Intuit outage across every tenant, and two would surface one.
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('QBO 500');
    });

    it('waits 1s then 2s between those attempts', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(503));
        vi.stubGlobal('fetch', fetchMock);

        const call = start(svc.apiCall(TENANT, 'GET', 'invoice/1'));

        await vi.advanceTimersByTimeAsync(900);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);           // t = 1.1s
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1_800);         // t = 2.9s
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(400);           // t = 3.3s
        expect(fetchMock).toHaveBeenCalledTimes(3);

        await call;
    });

    it('stops as soon as one attempt succeeds', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(async () => jsonResponse(502))
            .mockImplementation(async () => jsonResponse(200, { Invoice: { Id: '147' } }));
        vi.stubGlobal('fetch', fetchMock);

        const call = svc.apiCall<{ Invoice: { Id: string } }>(TENANT, 'GET', 'invoice/147');
        await vi.advanceTimersByTimeAsync(60_000);

        await expect(call).resolves.toEqual({ Invoice: { Id: '147' } });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a 4xx — the request itself is what is wrong', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(400, { Fault: { type: 'ValidationFault' } }));
        vi.stubGlobal('fetch', fetchMock);

        const err = await start(svc.apiCall(TENANT, 'POST', 'invoice')) as QboError;

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(err.message).toBe('QBO 400');
        // The caller gets the status and Intuit's own body, because a
        // validation fault names the field and only the caller can fix it.
        expect(err.status).toBe(400);
        expect(err.qboResponse).toEqual({ Fault: { type: 'ValidationFault' } });
    });

    it('does not retry a 404 either', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(404));
        vi.stubGlobal('fetch', fetchMock);

        await start(svc.apiCall(TENANT, 'GET', 'invoice/999'));

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('apiCall honours the interval a rate limit asks for', () => {
    beforeEach(() => seedConnection(FAR));

    it('waits the Retry-After header before the next attempt', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(async () => jsonResponse(429, {}, { 'Retry-After': '5' }))
            .mockImplementation(async () => jsonResponse(200, { ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        const call = svc.apiCall<{ ok: number }>(TENANT, 'GET', 'invoice/1');

        // Still inside the interval Intuit named — retrying here is how a rate
        // limit turns into a block.
        await vi.advanceTimersByTimeAsync(4_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // 5s of Retry-After plus the loop's own 1s backoff for attempt 2.
        await vi.advanceTimersByTimeAsync(2_100);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(call).resolves.toEqual({ ok: 1 });
    });

    it('falls back to 60 seconds when the header is absent', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(async () => jsonResponse(429, {}))
            .mockImplementation(async () => jsonResponse(200, { ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        const call = svc.apiCall<{ ok: number }>(TENANT, 'GET', 'invoice/1');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(31_100);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(call).resolves.toEqual({ ok: 1 });
    });

    it('a 429 consumes an attempt like any other failure', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(429, {}, { 'Retry-After': '1' }));
        vi.stubGlobal('fetch', fetchMock);

        const call = start(svc.apiCall(TENANT, 'GET', 'invoice/1'));
        await vi.advanceTimersByTimeAsync(60_000);
        const err = await call as QboError;

        expect(fetchMock).toHaveBeenCalledTimes(3);
        // Nothing on the 429 path records a `lastError`, so a purely
        // rate-limited call surfaces the generic message rather than "QBO 429".
        // Pinned as observed: the caller cannot tell a rate limit from a 5xx.
        expect(err.message).toBe('QBO API call failed after retries');
        expect(err.status).toBeUndefined();
    });
});

describe('what surfaces after the last attempt', () => {
    beforeEach(() => seedConnection(FAR));

    it('throws, and writes no sync-error row of its own', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500)));

        const call = start(svc.apiCall(TENANT, 'GET', 'invoice/1'));
        await vi.advanceTimersByTimeAsync(60_000);
        const err = await call as QboError;

        expect(err).toBeInstanceOf(Error);
        // The transport does not decide that a failure is worth a human's
        // attention — recording it is the caller's call, via logSyncError.
        expect(db.select().from(schema.qboSyncErrors).all()).toHaveLength(0);
    });

    it('logSyncError is what turns that throw into a row someone can see', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500)));

        const call = start(svc.apiCall(TENANT, 'GET', 'invoice/1'));
        await vi.advanceTimersByTimeAsync(60_000);
        const err = await call;

        await svc.logSyncError(TENANT, 'invoice', 'inv-1', err);

        const rows = db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.tenantId, TENANT)).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            oiType: 'invoice', oiId: 'inv-1', errorCode: 'SYNC_ERROR', errorMsg: 'QBO 500', resolved: false,
        });
    });
});

describe('the request apiCall builds', () => {
    beforeEach(() => seedConnection(FAR));

    it('pins the minor version onto the realm-scoped URL with the right separator', async () => {
        const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => jsonResponse(200, { ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        await svc.apiCall(TENANT, 'GET', 'invoice/147');
        await svc.apiCall(TENANT, 'GET', 'query?query=select%20*');

        expect(fetchMock.mock.calls[0][0]).toBe(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}/invoice/147?minorversion=75`,
        );
        // A path that already carries a query must not get a second '?'.
        expect(fetchMock.mock.calls[1][0]).toBe(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}/query?query=select%20*&minorversion=75`,
        );
        const opts = fetchMock.mock.calls[0][1]!;
        expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer at');
    });

    it('refuses to guess a host when QBO_ENV is unset — before spending a token refresh', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(200, { ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        const unset = new QBOServiceBase({} as D1Database, 'cid', 'csec', 'whsec', 'a'.repeat(32), undefined);

        await expect(unset.apiCall(TENANT, 'GET', 'invoice/1')).rejects.toThrow(/QBO_ENV/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('getToken refreshes on the 300-second threshold, not on a mock', () => {
    const tokenPayload = {
        access_token: 'new-at', refresh_token: 'new-rt', x_refresh_token_expires_in: 8_726_400, token_type: 'bearer',
    };

    it('uses the stored access token when more than 300 seconds remain', async () => {
        await seedConnection(600_000);
        const fetchMock = vi.fn(async () => jsonResponse(200, tokenPayload));
        vi.stubGlobal('fetch', fetchMock);

        await expect(svc.getToken(TENANT)).resolves.toEqual({ accessToken: 'at', realmId: REALM, tenantId: TENANT });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not refresh at exactly 300 seconds — the window is strictly under', async () => {
        await seedConnection(300_000);
        const fetchMock = vi.fn(async () => jsonResponse(200, tokenPayload));
        vi.stubGlobal('fetch', fetchMock);

        await expect(svc.getToken(TENANT)).resolves.toMatchObject({ accessToken: 'at' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes one second inside the window and stores the rotated pair', async () => {
        await seedConnection(299_000);
        const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => jsonResponse(200, tokenPayload));
        vi.stubGlobal('fetch', fetchMock);

        await expect(svc.getToken(TENANT)).resolves.toEqual({
            accessToken: 'new-at', realmId: REALM, tenantId: TENANT,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');

        const row = db.select().from(schema.qboConnections)
            .where(eq(schema.qboConnections.tenantId, TENANT)).get();
        // Intuit rotates the refresh token on every exchange; keeping the old
        // one would fail the NEXT refresh, a day later, for no visible reason.
        expect(row!.accessToken).toBe('enc:new-at');
        expect(row!.refreshToken).toBe('enc:new-rt');
        expect(row!.tokenExpiresAt.getTime()).toBe(NOW.getTime() + 3_600_000);
        expect(row!.refreshTokenExpiresAt.getTime()).toBe(NOW.getTime() + 8_726_400_000);
    });

    it('refreshes when the access token is already expired', async () => {
        await seedConnection(-60_000);
        const fetchMock = vi.fn(async () => jsonResponse(200, tokenPayload));
        vi.stubGlobal('fetch', fetchMock);

        await expect(svc.getToken(TENANT)).resolves.toMatchObject({ accessToken: 'new-at' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('raises for a tenant that never connected instead of returning an empty token', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(200, tokenPayload));
        vi.stubGlobal('fetch', fetchMock);

        await expect(svc.getToken(TENANT)).rejects.toThrow(/No QBO connection/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
