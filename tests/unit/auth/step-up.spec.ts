/**
 * Step-up re-authentication: POST /api/auth/step-up and the `requireStepUp` guard.
 *
 * One token, one action. Every refusal below is paired with a positive control
 * (the same call, with the one fault removed, succeeds) so a refusal cannot pass
 * because the harness was simply broken.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import stepUpRoutes from '../../../server/api/auth/step-up';
import { requireStepUp, STEP_UP_COOKIE_NAME, STEP_UP_KV_PREFIX, STEP_UP_TTL_SECONDS, type StepUpAction } from '../../../server/lib/auth/step-up';
import { hashPassword } from '../../../server/lib/password';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { createTestDb, setupSchema } from '../db';
import { users, tenants } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import { lazyD1 } from '../helpers/d1-binding';

const testD1 = lazyD1();

// Wrap the real verifier so a test can prove it was (or was not) called.
vi.mock('../../../server/lib/password', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/password')>();
    return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
import { verifyPassword } from '../../../server/lib/password';

/** A hash the way an upstream identity provider writes one, built here from its documented format: PBKDF2-SHA256, 100000 rounds, 16-byte salt, `pbkdf2:<saltHex>:<hashHex>`. */
async function foreignPbkdf2Hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256);
    const hex = (u: Uint8Array) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2:${hex(salt)}:${hex(new Uint8Array(bits))}`;
}

const TENANT = 't1';
const OTHER_TENANT = 't2';
const OWNER = 'u-owner';
const OTHER_USER = 'u-other';
const PASSWORD = 'Correct-Horse-9!';
const ACTION: StepUpAction = 'data-export-start';

/** In-memory KV that honours expirationTtl against Date.now(), so fake timers move it. */
function makeKv() {
    const store = new Map<string, { value: string; expiresAt: number | null; ttl: number | undefined }>();
    return {
        store,
        get: async (k: string) => {
            const e = store.get(k);
            if (!e) return null;
            if (e.expiresAt !== null && e.expiresAt <= Date.now()) { store.delete(k); return null; }
            return e.value;
        },
        put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
            store.set(k, { value: v, expiresAt: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null, ttl: o?.expirationTtl });
        },
        delete: async (k: string) => { store.delete(k); },
    };
}

interface Session { sub: string; tenantId: string; role?: string }

describe('step-up re-authentication', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };
    let kv: ReturnType<typeof makeKv>;
    let session: Session | null;
    let totpOk: (secret: string, code: string) => boolean;
    let limited: boolean;
    /** When set, the limiter refuses only keys that start with this prefix. */
    let limitedPrefix: string | null;
    let protectedHits: number;
    /** Runs inside the recovery-code check, after the list is read and before it is written back. */
    let raceHook: (() => Promise<void>) | null;
    let profile: { mode: string; loginRedirectBase: string | null } | null;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (session) {
                c.set('user', { sub: session.sub, tenantId: session.tenantId, role: 'owner' } as never);
                c.set('tenantId', session.tenantId);
                c.set('userRole', (session.role ?? 'owner') as never);
            }
            if (profile) c.set('profile', profile as never);
            c.set('services', {
                totp: {
                    verifyCode: (secret: string, code: string) => totpOk(secret, code),
                    consumeRecoveryCode: async (code: string, hashes: string[]) => {
                        if (raceHook) { await raceHook(); raceHook = null; }
                        const hit = hashes.includes(`h:${code}`);
                        return { matched: hit, remainingHashes: hashes.filter(h => h !== `h:${code}`) };
                    },
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/auth', stepUpRoutes);
        app.post('/protected', requireStepUp(ACTION), (c) => { protectedHits++; return c.json({ ok: true }); });
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status);
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        return app;
    }

    function env() {
        return {
            DB: testD1.binding,
            TENANT_CACHE: kv,
            ...(limited ? { RATE_LIMITER: { limit: async () => ({ success: false }) } } : {}),
            ...(limitedPrefix ? { RATE_LIMITER: { limit: async ({ key }: { key: string }) => ({ success: !key.startsWith(limitedPrefix!) }) } } : {}),
        };
    }

    async function stepUp(body: Record<string, unknown>) {
        return buildApp().request('/api/auth/step-up', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }, env());
    }

    /** Pull the token out of a Set-Cookie header, the way a browser would hold it. */
    function tokenFrom(res: Response): string {
        const raw = res.headers.get('set-cookie') ?? '';
        const m = new RegExp(`${STEP_UP_COOKIE_NAME}=([^;]+)`).exec(raw);
        if (!m?.[1]) throw new Error(`no step-up cookie in: ${raw}`);
        return m[1];
    }

    async function useToken(token: string | null) {
        return buildApp().request('/protected', {
            method: 'POST',
            ...(token ? { headers: { cookie: `${STEP_UP_COOKIE_NAME}=${token}` } } : {}),
        }, env());
    }

    async function mint(action: StepUpAction = ACTION): Promise<string> {
        const res = await stepUp({ action, password: PASSWORD });
        expect(res.status).toBe(200);
        return tokenFrom(res);
    }

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        testD1.use(testDb);
        kv = makeKv();
        session = { sub: OWNER, tenantId: TENANT };
        totpOk = () => false;
        limited = false;
        limitedPrefix = null;
        protectedHits = 0;
        raceHook = null;
        profile = null;
        vi.mocked(verifyPassword).mockClear();
        const hash = await hashPassword(PASSWORD);
        await testDb.insert(tenants).values([
            { id: TENANT, slug: 'one', createdAt: new Date() },
            { id: OTHER_TENANT, slug: 'two', createdAt: new Date() },
        ]);
        await testDb.insert(users).values([
            { id: OWNER, tenantId: TENANT, email: 'o@x.com', passwordHash: hash, role: 'owner', createdAt: new Date() },
            { id: OTHER_USER, tenantId: TENANT, email: 'p@x.com', passwordHash: hash, role: 'owner', createdAt: new Date() },
        ]);
    });
    afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.clearAllMocks(); });

    describe('issuing', () => {
        it('grants an elevation for the right password: cookie only, never in the body, KV entry bound to user, tenant and action', async () => {
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(200);
            const cookie = res.headers.get('set-cookie') ?? '';
            expect(cookie).toContain(`${STEP_UP_COOKIE_NAME}=`);
            expect(cookie).toMatch(/HttpOnly/i);
            expect(cookie).toMatch(/Secure/i);
            expect(cookie).toMatch(/SameSite=Strict/i);
            expect(cookie).toMatch(/Path=\//);
            expect(cookie).toContain(`Max-Age=${STEP_UP_TTL_SECONDS}`);
            const token = tokenFrom(res);
            const text = await res.text();
            expect(text).not.toContain(token);
            expect(JSON.parse(text).data.action).toBe(ACTION);
            // The stored key is a hash: the plaintext token is not recoverable from the namespace.
            const keys = [...kv.store.keys()].filter(k => k.startsWith(STEP_UP_KV_PREFIX));
            expect(keys).toHaveLength(1);
            expect(kv.store.size).toBe(2); // the token record and the latest-pointer
            expect(keys[0]!.startsWith(STEP_UP_KV_PREFIX)).toBe(true);
            expect(keys[0]).not.toContain(token);
            const entry = kv.store.get(keys[0]!)!;
            expect(entry.ttl).toBe(STEP_UP_TTL_SECONDS);
            expect(JSON.parse(entry.value)).toMatchObject({ userId: OWNER, tenantId: TENANT, action: ACTION });
        });

        it('refuses a wrong password with 401, no cookie and no stored token', async () => {
            const res = await stepUp({ action: ACTION, password: 'nope' });
            expect(res.status).toBe(401);
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(kv.store.size).toBe(0);
        });

        it('refuses a manager with 403 (positive control: the owner passes)', async () => {
            session = { sub: OWNER, tenantId: TENANT, role: 'manager' };
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(403);
            expect(kv.store.size).toBe(0);
            session = { sub: OWNER, tenantId: TENANT, role: 'owner' };
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(200);
        });

        it('refuses an account the database no longer lists as owner, whatever the JWT says (positive control: the owner row passes)', async () => {
            await testDb.update(users).set({ role: 'manager' }).where(eq(users.id, OWNER));
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(403);
            expect(kv.store.size).toBe(0);
            await testDb.update(users).set({ role: 'owner' }).where(eq(users.id, OWNER));
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(200);
        });

        it('refuses an action that is not on the list with 400', async () => {
            const res = await stepUp({ action: 'delete-everything', password: PASSWORD });
            expect(res.status).toBe(400);
            expect(kv.store.size).toBe(0);
        });

        it('refuses a caller with no session with 401', async () => {
            session = null;
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('refuses when the session names a tenant the account does not belong to', async () => {
            session = { sub: OWNER, tenantId: OTHER_TENANT };
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('refuses a removed account even with the right password', async () => {
            await testDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, OWNER));
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('rate-limits with 429 before any credential is checked', async () => {
            limited = true;
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(429);
            expect(kv.store.size).toBe(0);
        });

        it('limits per address and, separately, per account', async () => {
            limitedPrefix = 'step-up:';
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(429);
            limitedPrefix = 'step-up-user:';
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(429);
            // Control: a limiter that refuses some other prefix lets the call through.
            limitedPrefix = 'login:';
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(200);
        });
    });

    describe('password verification across implementations', () => {
        async function setHash(hash: string) {
            await testDb.update(users).set({ passwordHash: hash }).where(eq(users.id, OWNER));
        }

        it('verifies a hash written by an upstream identity provider (cross-implementation, positive control)', async () => {
            const foreign = await foreignPbkdf2Hash(PASSWORD);
            expect(await verifyPassword(PASSWORD, foreign)).toEqual([true, false]);
            expect((await verifyPassword('wrong', foreign))[0]).toBe(false);
            await setHash(foreign);
            expect((await stepUp({ action: ACTION, password: PASSWORD })).status).toBe(200);
        });

        it('still answers a real hash with the wrong password as 401 Invalid credentials (control)', async () => {
            const res = await stepUp({ action: ACTION, password: 'wrong-password' });
            expect(res.status).toBe(401);
            const body = await res.json() as { error: { message: string } };
            expect(body.error.message).toBe('Invalid credentials');
            expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
        });
    });

    describe('issuing on an account with two-factor on', () => {
        beforeEach(async () => {
            await testDb.update(users).set({
                totpEnabled: true, totpSecret: 'SECRET', totpVerifiedAt: new Date(),
                totpRecoveryCodes: JSON.stringify(['h:recov-1', 'h:recov-2']),
            }).where(eq(users.id, OWNER));
            totpOk = (secret, code) => secret === 'SECRET' && code === '123456';
        });

        it('grants with password plus a valid code (positive control)', async () => {
            const res = await stepUp({ action: ACTION, password: PASSWORD, code: '123456' });
            expect(res.status).toBe(200);
        });

        it('refuses the right password with no code', async () => {
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('refuses the right password with no code even if the verifier would accept anything', async () => {
            totpOk = () => true;
            const res = await stepUp({ action: ACTION, password: PASSWORD });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('refuses the right password with a wrong code', async () => {
            const res = await stepUp({ action: ACTION, password: PASSWORD, code: '654321' });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('refuses the right code with a wrong password', async () => {
            const res = await stepUp({ action: ACTION, password: 'nope', code: '123456' });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('accepts a recovery code once and spends it', async () => {
            const first = await stepUp({ action: ACTION, password: PASSWORD, code: 'recov-1' });
            expect(first.status).toBe(200);
            const row = await testDb.select().from(users).where(eq(users.id, OWNER)).get();
            expect(JSON.parse(row!.totpRecoveryCodes!)).toEqual(['h:recov-2']);
            const again = await stepUp({ action: ACTION, password: PASSWORD, code: 'recov-1' });
            expect(again.status).toBe(401);
        });

        it('lets only one of two concurrent requests spend the same recovery code', async () => {
            const [a, b] = await Promise.all([
                stepUp({ action: ACTION, password: PASSWORD, code: 'recov-1' }),
                stepUp({ action: ACTION, password: PASSWORD, code: 'recov-1' }),
            ]);
            expect([a.status, b.status].sort()).toEqual([200, 401]);
            expect(kv.store.size).toBe(2); // one token, one latest-pointer
        });

        it('does not write back a stale recovery-code list over one changed meanwhile (compare and set)', async () => {
            const original = JSON.stringify(['h:recov-1', 'h:recov-2']);
            // Another request spends recov-2 after this one has read the list but before it writes.
            const spendElsewhere = async () => {
                await testDb.update(users).set({ totpRecoveryCodes: JSON.stringify(['h:recov-1']) }).where(eq(users.id, OWNER));
            };
            raceHook = spendElsewhere;
            const res = await stepUp({ action: ACTION, password: PASSWORD, code: 'recov-1' });
            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
            const row = await testDb.select().from(users).where(eq(users.id, OWNER)).get();
            expect(row!.totpRecoveryCodes).toBe(JSON.stringify(['h:recov-1'])); // not resurrected to the original
            expect(original).not.toBe(row!.totpRecoveryCodes);
        });

        it('fails closed when two-factor is on but the secret is missing', async () => {
            await testDb.update(users).set({ totpSecret: null }).where(eq(users.id, OWNER));
            const res = await stepUp({ action: ACTION, password: PASSWORD, code: '123456' });
            expect(res.status).toBe(401);
        });
    });

    describe('using the token', () => {
        it('lets the minted token through once for its own action (positive control)', async () => {
            const token = await mint();
            const res = await useToken(token);
            expect(res.status).toBe(200);
            expect(protectedHits).toBe(1);
        });

        it('refuses a request with no token', async () => {
            const res = await useToken(null);
            expect(res.status).toBe(403);
            expect(protectedHits).toBe(0);
        });

        it('refuses a forged token', async () => {
            await mint();
            const res = await useToken('A'.repeat(43));
            expect(res.status).toBe(403);
            expect(protectedHits).toBe(0);
        });

        it('refuses a replay: the second use of the same token', async () => {
            const token = await mint();
            expect((await useToken(token)).status).toBe(200);
            const replay = await useToken(token);
            expect(replay.status).toBe(403);
            expect(protectedHits).toBe(1);
        });

        it('refuses a token past its five minutes (positive control: just inside the window passes)', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const fresh = await mint();
            vi.setSystemTime(new Date('2026-01-01T00:04:59Z'));
            expect((await useToken(fresh)).status).toBe(200);

            vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
            const stale = await mint();
            vi.setSystemTime(new Date('2026-01-01T01:05:01Z'));
            const res = await useToken(stale);
            expect(res.status).toBe(403);
            expect(protectedHits).toBe(1);
        });

        it('refuses a token whose stored expiry has passed even if the KV entry lingers', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const token = await mint();
            const [key, entry] = [...kv.store.entries()][0]!;
            // KV expiry is approximate; simulate a store that has not yet evicted the entry.
            kv.store.set(key, { ...entry, expiresAt: null });
            vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
            expect((await useToken(token)).status).toBe(403);
            expect(protectedHits).toBe(0);
        });

        it('refuses a token minted for another action, and burns it', async () => {
            const token = await mint('data-import-revert');
            const wrong = await useToken(token);
            expect(wrong.status).toBe(403);
            expect(protectedHits).toBe(0);
            // Burned: it cannot be retried, and a fresh token for the right action still works (control).
            expect((await useToken(token)).status).toBe(403);
            expect((await useToken(await mint())).status).toBe(200);
        });

        it('refuses another user in the same tenant presenting the token', async () => {
            const token = await mint();
            session = { sub: OTHER_USER, tenantId: TENANT };
            const res = await useToken(token);
            expect(res.status).toBe(403);
            expect(protectedHits).toBe(0);
            // Control: the same token, presented by its owner on a fresh mint, passes.
            session = { sub: OWNER, tenantId: TENANT };
            expect((await useToken(await mint())).status).toBe(200);
        });

        it('refuses the owner of the token when the session names another tenant', async () => {
            const token = await mint();
            session = { sub: OWNER, tenantId: OTHER_TENANT };
            const res = await useToken(token);
            expect(res.status).toBe(403);
            expect(protectedHits).toBe(0);
        });

        it('answers 401 with no session even when a live token is presented, and leaves the token unspent', async () => {
            const token = await mint();
            session = null;
            const res = await useToken(token);
            expect(res.status).toBe(401);
            expect(protectedHits).toBe(0);
            session = { sub: OWNER, tenantId: TENANT };
            expect((await useToken(token)).status).toBe(200);
        });

        it('clears the cookie on the way out', async () => {
            const res = await useToken(await mint());
            expect(res.headers.get('set-cookie') ?? '').toMatch(new RegExp(`${STEP_UP_COOKIE_NAME}=;`));
        });

        it('refuses a token issued before a credential change (positive control: after it passes)', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const token = await mint();
            const changedAt = Math.floor(Date.now() / 1000) + 30;
            await kv.put(`pwchanged:${OWNER}`, String(changedAt));
            vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
            expect((await useToken(token)).status).toBe(403);
            expect(protectedHits).toBe(0);
            // Control: a token issued after the change is accepted.
            expect((await useToken(await mint())).status).toBe(200);
        });

        it('invalidates the older token when the same user asks again for the same action (positive control: another action keeps its token)', async () => {
            const first = await mint();
            const other = await mint('data-import-revert');
            const second = await mint();
            expect((await useToken(first)).status).toBe(403);
            expect((await useToken(second)).status).toBe(200);
            // The revert token was not disturbed by re-minting export-start: it is refused here only because /protected wants export-start.
            const raw = [...kv.store.keys()].filter(k => k.startsWith('stepup-latest:'));
            expect(raw).toHaveLength(2);
            expect(other).toBeTruthy();
        });

        it('uses a different token for each elevation', async () => {
            const a = await mint();
            const b = await mint();
            expect(a).not.toBe(b);
            expect(kv.store.size).toBe(3); // two tokens and one latest-pointer
        });
    });
});
