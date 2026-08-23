/**
 * The signed unsubscribe link — the way out of an email that needs no session.
 *
 * ── Why this is not an exemption ────────────────────────────────────────────
 * An agent whose session is held by the agent-terms gate cannot reach
 * `/api/agent/notification-preferences`, so today there is no way for them to
 * stop email. The fix is NOT another entry in the gate's exempt list. The
 * endpoint under test lives at `/api/public/unsubscribe`, which the JWT
 * middleware short-circuits before it classifies anybody — so `agentUserId` is
 * never set and the gate returns on its first line. That is the same shape as
 * the SMS STOP webhook, and it is a structural property, not a decision anyone
 * has to keep re-making.
 *
 * The FIRST test below is what makes that claim checkable rather than assumed:
 * the same request, with the same held session cookie, is refused on the agent
 * route and accepted on this one.
 *
 * ── Positive controls ───────────────────────────────────────────────────────
 * Every refusal here is paired with an acceptance in the same file. "A forged
 * token is refused" is satisfied by an endpoint that refuses everything, and a
 * suite that only asserts refusals cannot tell the two apart.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { hashPassword } from '../../../server/lib/password';
import { buildKeyring, type JwtKeyring } from '../../../server/lib/jwt-keyring';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { jwtAuthMiddleware } from '../../../server/lib/middleware/jwt-auth';
import { agentTermsGate } from '../../../server/lib/middleware/agent-terms-gate';
import { agentLoginRoutes } from '../../../server/api/agent/login';
import agentNotificationPreferenceRoutes from '../../../server/api/agent/notification-preferences';
import unsubscribeRoutes from '../../../server/api/unsubscribe';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../../server/lib/notifications/unsubscribe-token';
import { isPreferenceMuted } from '../../../server/lib/notifications/preference-port';
import { readChoices } from '../../../server/lib/notifications/preference-write';
import { deliverWithUnsubscribe } from '../../../server/lib/notifications/unsubscribe-footer';
import type { EmailProvider, EmailSendArgs } from '../../../server/lib/email/provider';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 't-acme';
const AGENT_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';
const CONTACT_ID = 'contact-agent-1';
const PASSWORD = 'CorrectHorse123!Battery';
const SECRET = 'unsubscribe-test-secret';

/** A class the recipient is allowed to switch off (agent audience, email). */
const OPTIONAL_CLASS = 'agent-new-referral';
/** A class they are told is always sent — the report that delivers their work. */
const ALWAYS_SENT_CLASS = 'report-ready';

const AGENT_PREFS = 'https://x.test/api/agent/notification-preferences';
const RESOLVE = 'https://x.test/api/public/unsubscribe/resolve';
const SET = 'https://x.test/api/public/unsubscribe';

function bufToPem(buf: ArrayBuffer, label: string): string {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END ${label}-----`;
}

async function genKeyring(): Promise<JwtKeyring> {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    return buildKeyring({
        JWT_PRIVATE_KEY_V1: bufToPem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        JWT_PUBLIC_KEY_V1: bufToPem(await crypto.subtle.exportKey('spki', publicKey), 'PUBLIC KEY'),
        JWT_CURRENT_KID: 'v1',
    });
}

function makeKv() {
    const store = new Map<string, string>();
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
    };
}

describe('the signed unsubscribe link', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let keyring: JwtKeyring;
    let kv: ReturnType<typeof makeKv>;

    beforeAll(async () => { keyring = await genKeyring(); });

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        kv = makeKv();

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme Inspections', updatedAt: new Date(),
        } as never);
        // The agent's account is GLOBAL (tenant_id null) — which is exactly why
        // the send path resolves them through their `contacts` row instead.
        await db.insert(schema.users).values({
            id: AGENT_ID, tenantId: null, email: AGENT_EMAIL, name: 'Agent Smith',
            role: 'agent', createdAt: new Date(), passwordHash: await hashPassword(PASSWORD),
            termsAccepted: null,
        } as never);
        await db.insert(schema.contacts).values({
            id: CONTACT_ID, tenantId: TENANT, email: AGENT_EMAIL, name: 'Agent Smith',
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        // Publish agent terms the agent has NOT accepted, so the gate holds them.
        await new DeploymentLegalService(db as never).recordPublish({
            doc: 'agent_terms', version: '2026-08-01', body: 'the agent terms',
        });
    });

    afterEach(() => sqlite.close());

    /**
     * The middleware chain in the order `server/index.ts` registers it. Built
     * for real rather than stubbed: a `createRoutesStub` harness runs no
     * middleware at all, so an auth assertion on one is green whether or not the
     * gate is mounted.
     */
    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.env = { DB: {}, TENANT_CACHE: kv, JWT_SECRET: SECRET } as unknown as HonoConfig['Bindings'];
            c.set('profile', { mode: 'standalone' } as unknown as HonoConfig['Variables']['profile']);
            c.set('keyringPromise', Promise.resolve(keyring) as unknown as HonoConfig['Variables']['keyringPromise']);
            c.set('services', {
                email: { sendAgentLoginLink: vi.fn().mockResolvedValue(undefined) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.use('*', jwtAuthMiddleware);
        app.use('*', agentTermsGate);
        app.route('/api/agent', agentLoginRoutes);
        app.route('/api/agent', agentNotificationPreferenceRoutes);
        app.route('/api/public', unsubscribeRoutes);
        return app;
    }

    async function heldAgentCookie(app: OpenAPIHono<HonoConfig>): Promise<string> {
        const res = await app.request('https://x.test/api/agent/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: AGENT_EMAIL, password: PASSWORD }),
        });
        expect(res.status, 'signing in must work — the gate comes after').toBe(200);
        const jwt = (res.headers.get('set-cookie') ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1];
        expect(jwt, 'login must set the session cookie').toBeTruthy();
        return `__Host-inspector_token=${jwt}`;
    }

    const token = (classId = OPTIONAL_CLASS, email = AGENT_EMAIL) =>
        signUnsubscribeToken(SECRET, { tenantId: TENANT, email, classId });

    const post = (app: OpenAPIHono<HonoConfig>, body: unknown, headers: Record<string, string> = {}) =>
        app.request(SET, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
        });

    const rowCount = async () =>
        (await db.select().from(schema.notificationPreferences).all()).length;

    // ── the reason this exists ──────────────────────────────────────────────

    describe('reachability', () => {
        it('is reachable by an agent the terms gate is holding — the route the gate DOES hold is refused in the same breath', async () => {
            const app = buildApp();
            const cookie = await heldAgentCookie(app);

            // The problem, proven rather than asserted: the authenticated way to
            // switch email off is behind the gate.
            const gated = await app.request(AGENT_PREFS, { headers: { Cookie: cookie } });
            expect(gated.status, 'the agent preferences screen must be gated — otherwise this whole design is unnecessary').toBe(428);

            // The same session, the same browser, the same instant. Accepted,
            // because the JWT middleware never classified this path.
            const res = await post(app, { token: await token(), enabled: false }, { Cookie: cookie });
            expect(res.status, 'the unsubscribe endpoint must be outside the gate, not exempted from it').toBe(200);
        });

        it('is reachable with NO session at all — the state a mail client is in', async () => {
            const app = buildApp();
            const res = await post(app, { token: await token(), enabled: false });
            expect(res.status).toBe(200);
            expect(await rowCount()).toBe(1);
        });
    });

    // ── a GET must never mutate ─────────────────────────────────────────────

    describe('the GET side', () => {
        it('describes the link without acting on it — a link scanner must not unsubscribe anybody', async () => {
            const app = buildApp();
            const res = await app.request(`${RESOLVE}?token=${encodeURIComponent(await token())}`);
            expect(res.status).toBe(200);
            const body = (await res.json()) as { data: { companyName: string; label: string; muted: boolean } };
            expect(body.data.companyName).toBe('Acme Inspections');
            expect(body.data.label).toBe('A new referral is booked');
            expect(body.data.muted).toBe(false);
            expect(await rowCount(), 'a GET wrote a row — every mail scanner in the world is an unsubscribe button').toBe(0);
        });
    });

    // ── the token grants one action, on one recipient, in one scope ─────────

    describe('the token', () => {
        it('accepts one it signed and refuses one it did not', async () => {
            const app = buildApp();
            const good = await token();
            // Positive control FIRST, so a blanket-refusal endpoint cannot pass.
            expect((await post(app, { token: good, enabled: false })).status).toBe(200);

            const forged = `${good.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
            expect((await post(app, { token: forged, enabled: false })).status).toBe(404);
            expect(await rowCount(), 'the forged token must not have written anything').toBe(1);
        });

        it('refuses a body whose payload was edited after signing', async () => {
            const good = await token();
            const [body64] = good.split('.');
            const edited = JSON.parse(atob((body64 as string).replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, string>;
            edited.e = 'someone-else@example.com';
            const tampered = `${btoa(JSON.stringify(edited)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${good.split('.')[1]}`;
            expect(await verifyUnsubscribeToken(SECRET, tampered)).toBeNull();
            expect(await verifyUnsubscribeToken(SECRET, good)).not.toBeNull();
        });

        it('is refused by a different secret — rotating it revokes every link at once', async () => {
            expect(await verifyUnsubscribeToken('a-different-secret', await token())).toBeNull();
        });
    });

    // ── what may be switched off ────────────────────────────────────────────

    describe('what it may switch off', () => {
        it('refuses a class the recipient is told is always sent, and accepts one they may choose', async () => {
            const app = buildApp();
            // The one that must never work: a person waiting on their report
            // cannot be talked out of the mail that delivers it.
            const bad = await post(app, { token: await token(ALWAYS_SENT_CLASS), enabled: false });
            expect(bad.status).toBe(400);
            expect(await rowCount()).toBe(0);

            // The positive control, same endpoint, same recipient.
            expect((await post(app, { token: await token(), enabled: false })).status).toBe(200);
            expect(await rowCount()).toBe(1);
        });
    });

    // ── the row is the same row the signed-in screen writes ─────────────────

    describe('where the preference lands', () => {
        it('writes the row the send boundary reads, against the contact the send path resolves', async () => {
            const app = buildApp();
            expect((await post(app, { token: await token(), enabled: false })).status).toBe(200);

            const row = await db.select().from(schema.notificationPreferences).get();
            expect(row?.tenantId).toBe(TENANT);
            expect(row?.subjectKind).toBe('contact');
            expect(row?.subjectId).toBe(CONTACT_ID);
            expect(row?.classId).toBe(OPTIONAL_CLASS);
            expect(row?.channel).toBe('email');
            expect(row?.enabled).toBe(false);

            // Not just "a row exists" — the boundary itself now withholds it.
            expect(await isPreferenceMuted(db as never, TENANT, OPTIONAL_CLASS, 'email',
                [{ kind: 'contact', id: CONTACT_ID }])).toBe(true);
        });

        it('offers a way back that needs no account — the same cell, set the other way', async () => {
            const app = buildApp();
            expect((await post(app, { token: await token(), enabled: false })).status).toBe(200);
            expect(await rowCount()).toBe(1);

            expect((await post(app, { token: await token(), enabled: true })).status).toBe(200);
            // Matching the class default deletes the row rather than storing a
            // second contradictory answer.
            expect(await rowCount()).toBe(0);
            expect(await isPreferenceMuted(db as never, TENANT, OPTIONAL_CLASS, 'email',
                [{ kind: 'contact', id: CONTACT_ID }])).toBe(false);
        });

        it('is the same cell the signed-in agent screen writes, not a second store', async () => {
            const app = buildApp();
            expect((await post(app, { token: await token(), enabled: false })).status).toBe(200);
            const before = await db.select().from(schema.notificationPreferences).all();
            expect(before).toHaveLength(1);

            // `readChoices` is what the authenticated screen renders from. If the
            // link had written anywhere else, the screen would show this agent a
            // switch that is still on while the boundary withholds the mail —
            // and the two would drift with nothing to notice it.
            const chosen = await readChoices(db as never, TENANT, 'contact', CONTACT_ID);
            expect(chosen.get(`${OPTIONAL_CLASS}:email`)).toBe(false);
        });

        it('refuses an address this deployment has no record of, rather than reporting a success it did not record', async () => {
            const app = buildApp();
            const res = await post(app, { token: await token(OPTIONAL_CLASS, 'stranger@example.com'), enabled: false });
            expect(res.status).toBe(404);
            expect(await rowCount()).toBe(0);
        });
    });
    // ── the link has to reach people, or none of the above matters ──────────

    describe('what the mail carries', () => {
        /** Records every provider call so the fan-out is checkable, not assumed. */
        function recordingProvider() {
            const calls: EmailSendArgs[] = [];
            const provider = {
                sendEmail: async (args: EmailSendArgs) => { calls.push(args); return { ok: true as const }; },
                verifyWebhookSignature: async () => false,
                parseWebhookEvents: () => [],
            } as unknown as EmailProvider;
            return { provider, calls };
        }

        const links = {
            linkFor: async (classId: string, email: string) => `https://x.test/unsubscribe/${classId}~${email}`,
        };
        const envelope = { from: 'acme@x.test', subject: 'Hello' };

        it('gives each recipient their OWN link, and sends the always-sent mail untouched', async () => {
            // A class they may switch off: one call each, each carrying only
            // that person's link. A shared link would let either of them
            // unsubscribe the other.
            const optional = recordingProvider();
            await deliverWithUnsubscribe(optional.provider, envelope,
                ['a@x.test', 'b@x.test'], '<p>body</p>', links, OPTIONAL_CLASS);
            expect(optional.calls).toHaveLength(2);
            expect(optional.calls[0]!.to).toBe('a@x.test');
            expect(optional.calls[0]!.html).toContain('a@x.test');
            expect(optional.calls[0]!.html).not.toContain('b@x.test');
            expect(optional.calls[1]!.html).toContain('b@x.test');

            // The positive control that keeps report delivery honest: a class the
            // recipient is told is always sent carries NO link, because a link
            // leading to "this cannot be switched off" is a control that lies.
            const required = recordingProvider();
            await deliverWithUnsubscribe(required.provider, envelope,
                ['a@x.test', 'b@x.test'], '<p>body</p>', links, ALWAYS_SENT_CLASS);
            expect(required.calls).toHaveLength(1);
            expect(required.calls[0]!.to).toEqual(['a@x.test', 'b@x.test']);
            expect(required.calls[0]!.html).toBe('<p>body</p>');
        });

        it('still sends when the link cannot be minted — a footer is never worth a lost message', async () => {
            const rec = recordingProvider();
            const broken = { linkFor: async () => { throw new Error('no secret'); } };
            const out = await deliverWithUnsubscribe(rec.provider, envelope,
                ['a@x.test'], '<p>body</p>', broken, OPTIONAL_CLASS);
            expect(out.ok).toBe(true);
            expect(rec.calls[0]!.html).toBe('<p>body</p>');
        });

        it('reports the FIRST failure when it fanned out, not whichever call finished last', async () => {
            const calls: EmailSendArgs[] = [];
            const provider = {
                sendEmail: async (args: EmailSendArgs) => {
                    calls.push(args);
                    return calls.length === 1 ? { ok: false as const, error: 'bounced' } : { ok: true as const };
                },
                verifyWebhookSignature: async () => false,
                parseWebhookEvents: () => [],
            } as unknown as EmailProvider;
            const out = await deliverWithUnsubscribe(provider, envelope,
                ['a@x.test', 'b@x.test'], '<p>body</p>', links, OPTIONAL_CLASS);
            expect(out.ok).toBe(false);
        });
    });
});
