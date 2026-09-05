import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';
import { drizzle } from 'drizzle-orm/d1';
import { standaloneQboEnv, TENANT } from '../helpers/qbo-deployment-envs';

/**
 * The Intuit redirect lands here as a CROSS-SITE top-level navigation, so the
 * staff session cookie is not on it: `__Host-inspector_token` is
 * `SameSite=Strict` (`server/lib/auth-helpers.ts`), which withholds the cookie
 * on exactly this kind of navigation. A callback that authenticates by session
 * therefore cannot ever succeed — it 401s for every user, every time.
 *
 * So the callback is authorized by the `state` parameter instead, and these
 * assertions are written at the HTTP boundary with NO Cookie header at all,
 * because that is the only shape Intuit will ever send. A test that passes a
 * cookie would pass against a router that is broken in production.
 *
 * `createRoutesStub` is deliberately not used: it does not run middleware, so
 * it cannot tell an authorized callback from an unauthorized one.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// Authentication is not what is under test here. `/connect` still needs a
// verifier for its owner/manager guard; the callback must reach its handler
// without one.
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboOauthRoutes from '../../../server/api/qbo-oauth';
// eslint-disable-next-line import/order
import { QBO_OAUTH_MOUNT, qboRedirectUri } from '../../../server/lib/qbo-oauth-paths';

import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APP_BASE_URL = 'https://inspect.example.com';
const REALM_ID = '9130350000000000';

function makeKv() {
    const store = new Map<string, string>();
    return {
        store,
        get:    vi.fn(async (key: string) => store.get(key) ?? null),
        put:    vi.fn(async (key: string, value: string) => { store.set(key, value); }),
        delete: vi.fn(async (key: string) => { store.delete(key); }),
    };
}

const qboService = {
    // Typed against the real `withConnection` method so `.mock.calls[0][0]` is
    // the input object rather than an empty tuple.
    saveConnection:      vi.fn(async (_input: {
        tenantId: string;
        realmId: string;
        companyName: string | null;
        accessToken: string;
        refreshToken: string;
        refreshTokenExpiresIn: number;
    }) => {}),
    bootstrapDefaultItem: vi.fn(async () => {}),
};

/**
 * `role` is what the global JWT middleware would have established. The callback
 * is exercised with `undefined` — nothing upstream can identify the caller.
 */
function buildApp(kv: ReturnType<typeof makeKv>, role?: UserRole) {
    const app = new Hono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        if (role) {
            c.set('tenantId', TENANT_ID);
            c.set('userRole', role);
        }
        c.set('keyringPromise', Promise.resolve({} as never));
        c.set('services', { qbo: qboService } as never);
        return next();
    });

    app.route(QBO_OAUTH_MOUNT, qboOauthRoutes);
    return app;
}

const ENV = (kv: ReturnType<typeof makeKv>) => ({
    QBO_CLIENT_ID:     'test-client-id',
    QBO_CLIENT_SECRET: 'test-client-secret',
    QBO_ENV:           'sandbox',
    APP_BASE_URL,
    TENANT_CACHE:      kv,
    DB:                {},
    JWT_SECRET:        'a'.repeat(32),
}) as never;

// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const CTX = makeExecutionContext().ctx;

const INTUIT_TOKEN_HOST = 'oauth.platform.intuit.com';

/**
 * Match the token endpoint by EXACT host, never by substring.
 *
 * `String(u).includes('oauth.platform.intuit.com')` also matches
 * `https://evil.example/?next=oauth.platform.intuit.com`, so as a router it can
 * route the wrong call and as a finder it can find one. CodeQL flags the shape
 * (`js/incomplete-url-substring-sanitization`) and it is right to: the test is
 * weaker than it reads. Returns '' for an unparseable input so a malformed URL
 * simply does not match.
 */
function hostOf(u: unknown): string {
    try {
        return new URL(String(u)).hostname;
    } catch {
        return '';
    }
}

function tokenExchangeOk() {
    return vi.fn(async (input: RequestInfo | URL) => {
        if (hostOf(input) === INTUIT_TOKEN_HOST) {
            return new Response(JSON.stringify({
                access_token:               'at',
                refresh_token:              'rt',
                x_refresh_token_expires_in: 8_726_400,
                token_type:                 'bearer',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Sandbox Co' } }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    });
}

describe('QBO OAuth callback authorization', () => {
    let kv: ReturnType<typeof makeKv>;

    beforeEach(() => {
        kv = makeKv();
        qboService.saveConnection.mockClear();
        qboService.bootstrapDefaultItem.mockClear();
        vi.stubGlobal('fetch', tokenExchangeOk());
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('completes with NO cookie, resolving the tenant from the state', async () => {
        // Exactly what Intuit sends: a bare GET, cross-site, no Cookie header.
        kv.store.set('qbo_oauth_state:st-1', TENANT_ID);

        const res = await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-1&realmId=${REALM_ID}`,
            {},
            ENV(kv),
            CTX,
        );

        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?connected=1');
        expect(qboService.saveConnection).toHaveBeenCalledTimes(1);
        // The tenant must come from the state, not from a session that was
        // never sent. `undefined` here would write a connection row nobody owns.
        expect(qboService.saveConnection.mock.calls[0][0]).toMatchObject({
            tenantId: TENANT_ID,
            realmId:  REALM_ID,
        });
    });

    it('sends the token exchange the SAME redirect_uri it authorized with', async () => {
        // Intuit compares this byte-for-byte with the registered value; a
        // mismatch fails at the exchange, after the user already approved.
        kv.store.set('qbo_oauth_state:st-2', TENANT_ID);

        await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-2&realmId=${REALM_ID}`,
            {}, ENV(kv), CTX,
        );

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find((args: unknown[]) => hostOf(args[0]) === INTUIT_TOKEN_HOST);
        const body = new URLSearchParams(String((call![1] as RequestInit).body));
        expect(body.get('redirect_uri')).toBe(qboRedirectUri(APP_BASE_URL));
        expect(body.get('redirect_uri')).toBe(`${APP_BASE_URL}/api/integrations/qbo/callback`);
    });

    it('refuses to complete when QBO_ENV is unset, and says so distinctly', async () => {
        // Storing a token against an API host the worker will refuse to call
        // would leave the page saying "connected" while nothing ever syncs.
        //
        // Its own code, not the credential one: `not_configured`'s copy tells
        // the reader to fix the Client ID on the settings form, and here that
        // field is already correct.
        //
        // This rationale used to read "QBO_ENV is env-only in every deployment
        // mode". That is false, and it put the wrong model inside the reason a
        // test exists: `QBO_ENV` is a member of `INTEGRATION_SECRET_KEYS`
        // (`server/lib/secrets-catalog.ts`), it is on the credential form
        // (`QboCredentialsForm.tsx`), and `applyIntegrationSecrets` merges it.
        // This case is "neither place supplied it", not "this deployment cannot
        // supply it" — see the spec below, which pins the other half.
        kv.store.set('qbo_oauth_state:st-4', TENANT_ID);
        const env = { ...(ENV(kv) as object), QBO_ENV: undefined } as never;

        const res = await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-4&realmId=${REALM_ID}`, {}, env, CTX);

        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?error=missing_qbo_env');
        expect(qboService.saveConnection).not.toHaveBeenCalled();
    });

    it('completes on a SELF-HOSTED deploy, where every credential is in the tenant row', async () => {
        // The deployment shape no spec in this file had ever built.
        //
        // `ENV` above hardcodes the platform-supplied credentials, so
        // `!QBO_CLIENT_ID || !QBO_CLIENT_SECRET` was false on every run and the
        // tenant-credential fallback below it was dead in the whole suite. This
        // is the shape `qboAppManaged: false` produces: Intuit matches a
        // redirect URI byte for byte, so the platform's app cannot serve
        // someone else's domain, and Settings → Integrations is the ONLY place
        // the operator can put anything.
        //
        // `QBO_ENV` arriving from the tenant row is the specific half that was
        // impossible under the old guard: it names two of the four keys, so an
        // operator with the id and secret on the Worker env and the environment
        // on the form skipped the merge and got `?error=missing_qbo_env` for a
        // field they had filled in correctly.
        const fx = await standaloneQboEnv({
            tenantSecrets: {
                QBO_CLIENT_ID:     'tenant-client-id',
                QBO_CLIENT_SECRET: 'tenant-client-secret',
                QBO_ENV:           'sandbox',
            },
        });
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        kv.store.set('qbo_oauth_state:st-self', TENANT);

        const env = {
            ...(fx.env as object),
            APP_BASE_URL,
            TENANT_CACHE: kv,
        } as never;

        const res = await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-self&realmId=${REALM_ID}`,
            {}, env, CTX,
        );

        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?connected=1');
        expect(qboService.saveConnection).toHaveBeenCalledTimes(1);
    });

    it('completes when only QBO_ENV comes from the tenant row and the rest is on env', async () => {
        // THE case the deleted guard broke, and the reason the spec above is
        // not enough on its own: with `if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET)`
        // in place, a fully-self-hosted deploy still merged (env has neither),
        // so every all-or-nothing test passed either way. Only mixed provenance
        // separates them — the guard named two of the four keys, so an operator
        // with the id and secret on the Worker env and the environment on the
        // settings form skipped the merge entirely and was told
        // `missing_qbo_env` about a field they had filled in.
        const fx = await standaloneQboEnv({ tenantSecrets: { QBO_ENV: 'sandbox' } });
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        kv.store.set('qbo_oauth_state:st-mixed', TENANT);

        const env = {
            ...(fx.env as object),
            QBO_CLIENT_ID:     'platform-client-id',
            QBO_CLIENT_SECRET: 'platform-client-secret',
            APP_BASE_URL,
            TENANT_CACHE: kv,
        } as never;

        const res = await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-mixed&realmId=${REALM_ID}`,
            {}, env, CTX,
        );

        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?connected=1');
    });

    it('refuses an unknown state', async () => {
        const res = await buildApp(kv).request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=forged&realmId=${REALM_ID}`,
            {}, ENV(kv), CTX,
        );
        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?error=invalid_state');
        expect(qboService.saveConnection).not.toHaveBeenCalled();
    });

    it('refuses a REUSED state — single use is the whole guarantee', async () => {
        kv.store.set('qbo_oauth_state:st-3', TENANT_ID);
        const app = buildApp(kv);
        const first = await app.request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-3&realmId=${REALM_ID}`, {}, ENV(kv), CTX);
        expect(first.headers.get('location')).toBe('/settings/integrations/qbo?connected=1');

        const second = await app.request(
            `${QBO_OAUTH_MOUNT}/callback?code=c1&state=st-3&realmId=${REALM_ID}`, {}, ENV(kv), CTX);
        expect(second.headers.get('location')).toBe('/settings/integrations/qbo?error=invalid_state');
        expect(qboService.saveConnection).toHaveBeenCalledTimes(1);
    });
});

describe('QBO OAuth connect guard', () => {
    let kv: ReturnType<typeof makeKv>;

    beforeEach(() => { kv = makeKv(); });

    function connect(role?: UserRole) {
        return buildApp(kv, role).request(`${QBO_OAUTH_MOUNT}/connect`, {
            headers: { Cookie: '__Host-inspector_token=stub' },
        }, ENV(kv), CTX);
    }

    it('still refuses an inspector', async () => {
        expect((await connect('inspector')).status).toBe(403);
        expect(kv.store.size).toBe(0);
    });

    it('refuses a caller with no role', async () => {
        expect((await connect(undefined)).status).toBe(401);
    });

    it('stores the initiating tenant under the state key, not a placeholder', async () => {
        // The stored value IS the authorization the callback will read. A
        // placeholder makes the callback unable to tell whose books these are.
        const res = await connect('owner');
        expect(res.status).toBe(302);

        const authorizeUrl = new URL(res.headers.get('location')!);
        expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(qboRedirectUri(APP_BASE_URL));

        const state = authorizeUrl.searchParams.get('state')!;
        expect(kv.store.get(`qbo_oauth_state:${state}`)).toBe(TENANT_ID);
    });
});
