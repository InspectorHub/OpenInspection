/**
 * Step-up for an owner with no usable password (federated sign-up only): an
 * emailed one-time code stands in for the password.
 *
 * Every refusal is paired with a positive control. The mail sender is a fake;
 * nothing here reaches a real provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import stepUpRoutes from '../../../server/api/auth/step-up';
import { requireStepUp, STEP_UP_COOKIE_NAME, type StepUpAction } from '../../../server/lib/auth/step-up';
import { hashPassword } from '../../../server/lib/password';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { createTestDb, setupSchema } from '../db';
import { users, tenants, auditLogs } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import { lazyD1 } from '../helpers/d1-binding';
import { EmailTemplateRenderer } from '../../../server/lib/email-templates/renderer';

vi.mock('../../../server/lib/password', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/password')>();
    return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
import { verifyPassword } from '../../../server/lib/password';

const testD1 = lazyD1();
const TENANT = 't1';
const OWNER = 'u-owner';
const OWNER_EMAIL = 'owner@example.com';
const PASSWORD = 'Correct-Horse-9!';
const ACTION: StepUpAction = 'data-export-start';
const OTHER_ACTION: StepUpAction = 'data-import-apply';

interface Sent { to: string; code: string; actionLabel: string }

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

describe('step-up with an emailed code', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };
    let kv: ReturnType<typeof makeKv>;
    let sent: Sent[];
    let mailFails: boolean;
    let mailUndelivered: boolean;
    let emailForCalls: string[];
    let role: string;
    let signedIn: boolean;
    let limitedPrefix: string | null;
    let totpOk: boolean;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (signedIn) {
                c.set('user', { sub: OWNER, tenantId: TENANT, role } as never);
                c.set('tenantId', TENANT);
                c.set('userRole', role as never);
            }
            c.set('services', {
                totp: { verifyCode: () => totpOk, consumeRecoveryCode: async () => ({ matched: false, remainingHashes: [] }) },
                // The company's own mail service, resolved from the verified tenant: the route must ask for it by that id.
                emailFor: async (tenantId: string) => {
                    emailForCalls.push(tenantId);
                    return {
                        sendStepUpCode: async (to: string, code: string, actionLabel: string) => {
                            if (mailFails) throw new Error(`provider down for ${to}`);
                            if (mailUndelivered) return { delivered: false };
                            sent.push({ to, code, actionLabel });
                            return { delivered: true };
                        },
                    };
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/auth', stepUpRoutes);
        app.post('/protected', requireStepUp(ACTION), (c) => c.json({ ok: true }));
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
            ...(limitedPrefix ? { RATE_LIMITER: { limit: async ({ key }: { key: string }) => ({ success: !key.startsWith(limitedPrefix!) }) } } : {}),
        };
    }
    const post = (path: string, body: Record<string, unknown>) => buildApp().request(path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, env());
    const sendCode = (body: Record<string, unknown> = { action: ACTION }) => post('/api/auth/step-up/email-code', body);
    const verify = (body: Record<string, unknown>) => post('/api/auth/step-up', { action: ACTION, ...body });
    const lastCode = () => sent[sent.length - 1]!.code;
    const wrongCode = () => (lastCode() === '000000' ? '000001' : '000000');
    async function audit() {
        await new Promise(r => setTimeout(r, 30));
        return testDb.select().from(auditLogs).all();
    }
    async function noPassword(hash = 'unset:5c1d2c46-0000-4000-8000-000000000000') {
        await testDb.update(users).set({ passwordHash: hash }).where(eq(users.id, OWNER));
    }

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        testD1.use(testDb);
        kv = makeKv();
        sent = [];
        mailFails = false;
        mailUndelivered = false;
        emailForCalls = [];
        role = 'owner';
        signedIn = true;
        limitedPrefix = null;
        totpOk = false;
        vi.mocked(verifyPassword).mockClear();
        await testDb.insert(tenants).values({ id: TENANT, slug: 'one', createdAt: new Date() });
        await testDb.insert(users).values({
            id: OWNER, tenantId: TENANT, email: OWNER_EMAIL, passwordHash: await hashPassword(PASSWORD), role: 'owner', createdAt: new Date(),
        });
    });
    afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.clearAllMocks(); });

    describe('sending', () => {
        it('mails a six-digit code to the address in the user table, ignoring any address in the body', async () => {
            await noPassword();
            const res = await sendCode({ action: ACTION, email: 'attacker@example.com', to: 'attacker@example.com' });
            expect(res.status).toBe(200);
            expect(sent).toHaveLength(1);
            expect(sent[0]!.to).toBe(OWNER_EMAIL);
            expect(sent[0]!.code).toMatch(/^\d{6}$/);
            expect(sent[0]!.actionLabel).toBe('start a company data export');
            expect(emailForCalls).toEqual([TENANT]); // the mail service of the session's own company
            expect(JSON.stringify(await res.json())).not.toContain(sent[0]!.code);
        });

        it('stores only a hash: no plaintext code in any key or value, ten minute TTL', async () => {
            await noPassword();
            await sendCode();
            const code = lastCode();
            const entries = [...kv.store.entries()];
            expect(entries.length).toBeGreaterThan(0);
            for (const [k, e] of entries) {
                expect(k).not.toContain(code);
                expect(e.value).not.toContain(code);
            }
            const record = entries.find(([k]) => k.startsWith('stepup-code:'))!;
            expect(record[1].ttl).toBe(600);
        });

        it('refuses an account that has a usable password, sends nothing (positive control: a passwordless one is sent a code)', async () => {
            const res = await sendCode();
            expect(res.status).toBe(409);
            expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('STEP_UP_EMAIL_CODE_NOT_AVAILABLE');
            expect(sent).toHaveLength(0);
            expect(kv.store.size).toBe(0);
            await noPassword();
            expect((await sendCode()).status).toBe(200);
        });

        it('does the same for the erased-credential sentinel (positive control)', async () => {
            await noPassword('[erased]');
            expect((await sendCode()).status).toBe(200);
            expect(sent).toHaveLength(1);
        });

        it('refuses an action that is not on the list', async () => {
            await noPassword();
            expect((await sendCode({ action: 'delete-everything' })).status).toBe(400);
            expect(sent).toHaveLength(0);
        });

        it('refuses a manager (JWT) and a demoted owner (database), and no caller without a session; the owner is sent one', async () => {
            await noPassword();
            role = 'manager';
            expect((await sendCode()).status).toBe(403);
            role = 'owner';
            await testDb.update(users).set({ role: 'manager' }).where(eq(users.id, OWNER));
            expect((await sendCode()).status).toBe(403);
            await testDb.update(users).set({ role: 'owner' }).where(eq(users.id, OWNER));
            signedIn = false;
            expect((await sendCode()).status).toBe(401);
            expect(sent).toHaveLength(0);
            signedIn = true;
            expect((await sendCode()).status).toBe(200);
        });

        it('allows three codes per ten minutes and refuses the fourth with 429; the window then reopens', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            await noPassword();
            for (let i = 0; i < 3; i++) expect((await sendCode()).status).toBe(200);
            expect((await sendCode()).status).toBe(429);
            expect(sent).toHaveLength(3);
            vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
            expect((await sendCode()).status).toBe(200);
        });

        it('applies the per-address limiter too (positive control: another prefix passes)', async () => {
            await noPassword();
            limitedPrefix = 'step-up-code:';
            expect((await sendCode()).status).toBe(429);
            limitedPrefix = 'login:';
            expect((await sendCode()).status).toBe(200);
        });

        it('answers a failed delivery with a fixed 503 that names no address, and keeps no usable code', async () => {
            await noPassword();
            mailFails = true;
            const res = await sendCode();
            expect(res.status).toBe(503);
            const text = JSON.stringify(await res.json());
            expect(text).not.toContain(OWNER_EMAIL);
            expect([...kv.store.keys()].filter(k => k.startsWith('stepup-code:'))).toHaveLength(0);
        });
    });

    describe('a message the mail service skipped', () => {
        beforeEach(async () => { await noPassword(); });

        it('answers delivered:false with the same fixed 503, discards the code, records no code_sent and spends no send allowance', async () => {
            mailUndelivered = true;
            for (let i = 0; i < 4; i++) {
                const res = await sendCode();
                expect(res.status).toBe(503);
                expect(JSON.stringify(await res.json())).not.toContain(OWNER_EMAIL);
            }
            expect([...kv.store.keys()].filter(k => k.startsWith('stepup-code:'))).toHaveLength(0);
            expect((await audit()).filter(r => r.action === 'auth.step_up_code_sent')).toHaveLength(0);
            // Four skipped sends did not use the allowance of three: the next real one goes out (positive control).
            mailUndelivered = false;
            expect((await sendCode()).status).toBe(200);
            expect(sent).toHaveLength(1);
        });

        it('still counts a send that reached the provider and failed', async () => {
            mailFails = true;
            for (let i = 0; i < 3; i++) expect((await sendCode()).status).toBe(503);
            mailFails = false;
            expect((await sendCode()).status).toBe(429);
        });
    });

    describe('verifying', () => {
        beforeEach(async () => { await noPassword(); });

        it('grants the elevation for the right code, never calling the password verifier, and the token works once', async () => {
            await sendCode();
            const res = await verify({ emailCode: lastCode() });
            expect(res.status).toBe(200);
            expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
            const token = /__Host-step_up=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]!;
            const use = () => buildApp().request('/protected', { method: 'POST', headers: { cookie: `${STEP_UP_COOKIE_NAME}=${token}` } }, env());
            expect((await use()).status).toBe(200);
            expect((await use()).status).toBe(403);
        });

        it('spends the code on success: the same code cannot be used twice', async () => {
            await sendCode();
            const code = lastCode();
            expect((await verify({ emailCode: code })).status).toBe(200);
            expect((await verify({ emailCode: code })).status).toBe(401);
        });

        it('refuses a missing code and a password in place of a code, with the same fixed 401', async () => {
            await sendCode();
            const none = await verify({});
            expect(none.status).toBe(401);
            expect(((await none.json()) as { error: { message: string } }).error.message).toBe('Invalid credentials');
            expect((await verify({ password: PASSWORD })).status).toBe(401);
            expect((await verify({ password: 'unset:anything' })).status).toBe(401);
            expect((await verify({ emailCode: lastCode() })).status).toBe(200); // control
        });

        it('refuses a malformed code with the same 401 without counting an attempt; trims a well-formed one (positive control: a well-formed wrong code counts)', async () => {
            await sendCode();
            const attempts = () => JSON.parse([...kv.store.entries()].find(([k]) => k.startsWith('stepup-code:'))![1].value).attempts as number;
            for (const junk of ['', ' ', 'abcdef', '12345', '1234567', '12 456', 'x'.repeat(20)]) {
                const res = await verify({ emailCode: junk });
                expect(res.status, junk).toBe(401);
                expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Invalid credentials');
            }
            expect(attempts()).toBe(0);
            await verify({ emailCode: wrongCode() });
            expect(attempts()).toBe(1);
            expect((await verify({ emailCode: ` ${lastCode()} ` })).status).toBe(200);
        });

        it('refuses a wrong code with the fixed 401 and counts the attempt', async () => {
            await sendCode();
            const bad = await verify({ emailCode: wrongCode() });
            expect(bad.status).toBe(401);
            expect(((await bad.json()) as { error: { message: string } }).error.message).toBe('Invalid credentials');
            const record = [...kv.store.entries()].find(([k]) => k.startsWith('stepup-code:'))!;
            expect(JSON.parse(record[1].value).attempts).toBe(1);
            expect((await verify({ emailCode: lastCode() })).status).toBe(200); // control: still valid
        });

        it('voids the code after five wrong attempts, even for the right code (positive control: four wrong still allows it)', async () => {
            await sendCode();
            for (let i = 0; i < 4; i++) expect((await verify({ emailCode: wrongCode() })).status).toBe(401);
            expect((await verify({ emailCode: lastCode() })).status).toBe(200);
            await sendCode();
            for (let i = 0; i < 5; i++) expect((await verify({ emailCode: wrongCode() })).status).toBe(401);
            expect((await verify({ emailCode: lastCode() })).status).toBe(401);
        });

        it('refuses a code after ten minutes (positive control: just inside passes)', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            await sendCode();
            vi.setSystemTime(new Date('2026-01-01T00:09:59Z'));
            expect((await verify({ emailCode: lastCode() })).status).toBe(200);
            vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
            await sendCode();
            vi.setSystemTime(new Date('2026-01-01T01:10:01Z'));
            expect((await verify({ emailCode: lastCode() })).status).toBe(401);
        });

        it('refuses a code whose stored expiry has passed even if the KV entry lingers', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            await sendCode();
            const [key, entry] = [...kv.store.entries()].find(([k]) => k.startsWith('stepup-code:'))!;
            kv.store.set(key, { ...entry, expiresAt: null });
            vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
            expect((await verify({ emailCode: lastCode() })).status).toBe(401);
        });

        it('lets a newer code replace the older one', async () => {
            await sendCode();
            const first = lastCode();
            await sendCode();
            const second = lastCode();
            if (first === second) return; // one-in-a-million collision: nothing to prove
            expect((await verify({ emailCode: first })).status).toBe(401);
            expect((await verify({ emailCode: second })).status).toBe(200);
        });

        it('refuses a code asked for one action when used for another (positive control)', async () => {
            await sendCode({ action: ACTION });
            const code = lastCode();
            expect((await verify({ action: OTHER_ACTION, emailCode: code })).status).toBe(401);
            expect((await verify({ action: ACTION, emailCode: code })).status).toBe(200);
        });

        it('cannot be used to skip the password on an account that has one', async () => {
            await testDb.update(users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(users.id, OWNER));
            // Any code-shaped value is ignored: the password is still required and still checked.
            expect((await verify({ emailCode: '123456' })).status).toBe(401);
            expect((await verify({ password: 'wrong', emailCode: '123456' })).status).toBe(401);
            expect(vi.mocked(verifyPassword)).toHaveBeenCalled();
            expect((await verify({ password: PASSWORD, emailCode: '123456' })).status).toBe(200); // control
        });

        it('treats a corrupted recovery-code list as a refusal, not a server error (positive control: a good list still works)', async () => {
            await testDb.update(users).set({ totpEnabled: true, totpSecret: 'SECRET', totpVerifiedAt: new Date(), totpRecoveryCodes: '{not json' }).where(eq(users.id, OWNER));
            await sendCode();
            const bad = await verify({ emailCode: lastCode(), code: 'recov-1' });
            expect(bad.status).toBe(401);
            await testDb.update(users).set({ totpRecoveryCodes: JSON.stringify(['h:recov-1']) }).where(eq(users.id, OWNER));
            totpOk = true;
            await sendCode();
            expect((await verify({ emailCode: lastCode(), code: '123456' })).status).toBe(200);
        });

        it('still asks for the authenticator code after the emailed one when two-factor is on', async () => {
            await testDb.update(users).set({ totpEnabled: true, totpSecret: 'SECRET', totpVerifiedAt: new Date() }).where(eq(users.id, OWNER));
            await sendCode();
            expect((await verify({ emailCode: lastCode() })).status).toBe(401);
            await sendCode();
            totpOk = true;
            expect((await verify({ emailCode: lastCode(), code: '123456' })).status).toBe(200);
        });
    });

    describe('the guard failing', () => {
        it('clears the elevation cookie in the error response itself (positive control: a spent token is cleared on success too)', async () => {
            const res = await buildApp().request('/protected', { method: 'POST', headers: { cookie: `${STEP_UP_COOKIE_NAME}=forged` } }, env());
            expect(res.status).toBe(403);
            expect(res.headers.get('set-cookie') ?? '').toMatch(new RegExp(`${STEP_UP_COOKIE_NAME}=;`));
            await noPassword();
            await sendCode();
            const ok = await verify({ emailCode: lastCode() });
            const token = /__Host-step_up=([^;]+)/.exec(ok.headers.get('set-cookie') ?? '')![1]!;
            const used = await buildApp().request('/protected', { method: 'POST', headers: { cookie: `${STEP_UP_COOKIE_NAME}=${token}` } }, env());
            expect(used.status).toBe(200);
            expect(used.headers.get('set-cookie') ?? '').toMatch(new RegExp(`${STEP_UP_COOKIE_NAME}=;`));
        });
    });

    describe('audit', () => {
        it('records sent, granted and denied with action and enumerated reason only, and no secret', async () => {
            await noPassword();
            await sendCode();
            const code = lastCode();
            await verify({ emailCode: wrongCode() });
            const granted = await verify({ emailCode: code });
            const token = /__Host-step_up=([^;]+)/.exec(granted.headers.get('set-cookie') ?? '')![1]!;
            const rows = await audit();
            const byAction = (a: string) => rows.filter(r => r.action === a);
            expect(byAction('auth.step_up_code_sent')).toHaveLength(1);
            expect(byAction('auth.step_up_code_sent')[0]!.metadata).toEqual({ action: ACTION });
            expect(byAction('auth.step_up_denied')[0]!.metadata).toEqual({ action: ACTION, reason: 'bad_email_code' });
            expect(byAction('auth.step_up_granted')[0]!.metadata).toEqual({ action: ACTION, method: 'email_code' });
            const everything = JSON.stringify(rows);
            for (const secret of [code, token, PASSWORD, OWNER_EMAIL]) expect(everything).not.toContain(secret);
        });

        it('records an expired code, a wrong password, a demoted owner and a rate limit, each with its own reason', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            await noPassword();
            await sendCode();
            vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
            await verify({ emailCode: lastCode() });
            await testDb.update(users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(users.id, OWNER));
            await verify({ password: 'wrong' });
            await verify({ password: PASSWORD }); // granted by password
            await testDb.update(users).set({ role: 'manager' }).where(eq(users.id, OWNER));
            await verify({ password: PASSWORD });
            await testDb.update(users).set({ role: 'owner' }).where(eq(users.id, OWNER));
            limitedPrefix = 'step-up:';
            await verify({ password: PASSWORD });
            vi.useRealTimers();
            const rows = await audit();
            const denied = rows.filter(r => r.action === 'auth.step_up_denied').map(r => (r.metadata as { reason: string }).reason).sort();
            expect(denied).toEqual(['bad_credentials', 'code_expired', 'not_owner', 'rate_limited']);
            expect(rows.filter(r => r.action === 'auth.step_up_granted').map(r => r.metadata)).toEqual([{ action: ACTION, method: 'password' }]);
        });
    });

    describe('the message', () => {
        it('renders the code and the action in words, with no link and no internal id', () => {
            const r = new EmailTemplateRenderer({
                tenantBrand: { name: 'Acme', logoUrl: null, primaryColor: '#F55A1A' },
                platformBrand: { name: 'OpenInspection', logoUrl: null, primaryColor: '#4f46e5' },
                viewCountingEnabled: false,
            }).render('step-up-code', { code: '482913', actionLabel: 'start a company data export' });
            expect(r.enabled).toBe(true);
            expect(r.html).toContain('482913');
            expect(r.html).toContain('start a company data export');
            expect(r.html).toContain('contact your administrator');
            expect(r.html).not.toMatch(/href=/);
            expect(r.html).not.toContain(TENANT);
        });
    });
});
