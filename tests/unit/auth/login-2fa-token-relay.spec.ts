/**
 * POST /api/auth/login and /login/2fa — the token-relay contract with the login page.
 *
 * The login page does not talk to the browser's cookie jar. It calls the API
 * in-process through the BFF client, and that client does not forward the
 * API's Set-Cookie. The only way the page can open a session is to receive the
 * JWT in the body and write its own cookie (`createSessionWithToken`). The
 * password login has always honoured that: a caller sending `x-token-relay: 1`
 * gets `data.token`. The second-factor endpoint did not, so a correct TOTP code
 * entered on /login produced "Verification could not be completed" and no
 * session — and every test passed, because the page's unit test mocked a
 * `data.token` the server never sent, and the E2E spec only called the API.
 *
 * Driven through the REAL app (`server/index.ts`), real middleware chain, real
 * keyring and an in-memory D1 (see helpers/tenant-email-harness.ts). The token
 * is checked by verifying it against the deployment's own keyring, not by
 * shape. The negative case — no header, no token in the body — is the rule in
 * CLAUDE.md's JWT section: a browser must never be handed the JWT.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TOTP, Secret } from 'otpauth';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { hashPassword } from '../../../server/lib/password';
import { buildKeyring, verifyJwt } from '../../../server/lib/jwt-keyring';
import { TotpService } from '../../../server/services/totp.service';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { LoginResponseSchema } from '../../../server/lib/validations/auth.schema';

const EMAIL = 'owner@harbor-light.test';
const PASSWORD = 'Correct-Horse-Battery-9';

const codeFor = (secret: string) =>
    new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

/**
 * The API's CSRF check is a stateless double-submit (cookie equals header); the
 * BFF mints its own pair per request (app/lib/csrf.ts), so the test does too.
 */
const CSRF = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function postJson(body: Record<string, unknown>, headers: Record<string, string> = {}): RequestInit {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-csrf-token': CSRF,
            cookie: `__Host-csrf_token=${CSRF}`,
            ...headers,
        },
        body: JSON.stringify(body),
    };
}

async function call(h: Harness, path: string, init: RequestInit): Promise<Response> {
    const exec = makeExecutionContext({ label: path });
    const res = await app.request(path, init, h.env, exec.ctx);
    await exec.settle();
    return res;
}

/** Enrol the seeded owner: a real password and an active TOTP secret. */
async function enrol(h: Harness): Promise<string> {
    const secret = new TotpService().generateSecret();
    await h.db.update(schema.users).set({
        passwordHash: await hashPassword(PASSWORD),
        totpSecret: secret,
        totpEnabled: true,
        totpVerifiedAt: new Date(),
    }).where(eq(schema.users.id, OWNER_ID));
    return secret;
}

/** The first half of the sign-in: the password buys a challenge. */
async function challenge(h: Harness): Promise<string> {
    const res = await call(h, '/api/auth/login', postJson({ email: EMAIL, password: PASSWORD }, { 'x-token-relay': '1' }));
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const body = JSON.parse(text) as { data: { requires2fa?: boolean; challengeToken?: string; token?: string } };
    expect(body.data.requires2fa, 'a 2FA account gets a challenge').toBe(true);
    expect(body.data.token, 'and no session before the second factor, even for the BFF').toBeUndefined();
    return body.data.challengeToken!;
}

describe('POST /api/auth/login/2fa — token relay (standalone)', () => {
    let h: Harness;
    afterEach(() => h.close());

    it('returns a verifiable session JWT in data.token to a caller sending x-token-relay: 1', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        const secret = await enrol(h);
        const challengeToken = await challenge(h);

        const res = await call(h, '/api/auth/login/2fa', postJson({ challengeToken, code: codeFor(secret) }, { 'x-token-relay': '1' }));
        const text = await res.text();
        expect(res.status, text).toBe(200);
        const body = JSON.parse(text) as { data: { redirect?: string; token?: string } };
        expect(body.data.redirect).toBe('/inspections');
        expect(typeof body.data.token, `the BFF needs the JWT to open a session: ${text.slice(0, 300)}`).toBe('string');

        // Verified with the deployment's own keyring — a string that merely
        // looks like a JWT would not open a session either.
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const claims = await verifyJwt(body.data.token!, keyring);
        expect(claims['sub']).toBe(OWNER_ID);
        expect(claims['custom:tenantId']).toBe(TENANT_ID);
        expect(claims['t'], 'a session, not another challenge').toBeUndefined();
    });

    it('does NOT put the JWT in the body for a caller without the header, and still sets the cookie', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        const secret = await enrol(h);
        const challengeToken = await challenge(h);

        const res = await call(h, '/api/auth/login/2fa', postJson({ challengeToken, code: codeFor(secret) }));
        const text = await res.text();
        expect(res.status, text).toBe(200);
        const body = JSON.parse(text) as { data: { redirect?: string; token?: string } };
        expect(body.data.redirect).toBe('/inspections');
        expect(body.data.token, 'a browser must never be handed the JWT').toBeUndefined();
        // Positive control for the same response: the browser path still
        // gets its session, just not in the body.
        expect(res.headers.get('set-cookie') ?? '').toMatch(/__Host-inspector_token=[^;]+/);
    });
});

/**
 * The password step for an account WITHOUT a second factor: the same rule, on
 * the route whose response schema used to be shared with join and setup and so
 * did not declare `token` at all. Each body is parsed with the route's own
 * declared schema, so the documented shape and the handler cannot drift apart
 * without one of these failing.
 */
describe('POST /api/auth/login — token relay (standalone, no second factor)', () => {
    let h: Harness;
    afterEach(() => h.close());

    async function withPassword(): Promise<void> {
        h = await createHarness('standalone');
        await h.db.update(schema.users)
            .set({ passwordHash: await hashPassword(PASSWORD), totpEnabled: false })
            .where(eq(schema.users.id, OWNER_ID));
    }

    it('returns a verifiable session JWT in data.token to a caller sending x-token-relay: 1', { timeout: 60_000 }, async () => {
        await withPassword();
        const res = await call(h, '/api/auth/login', postJson({ email: EMAIL, password: PASSWORD }, { 'x-token-relay': '1' }));
        const text = await res.text();
        expect(res.status, text).toBe(200);
        const body = LoginResponseSchema.parse(JSON.parse(text));
        expect(body.data, text.slice(0, 300)).toHaveProperty('redirect', '/inspections');
        const token = (body.data as { token?: string }).token;
        expect(typeof token, `the BFF needs the JWT to open a session: ${text.slice(0, 300)}`).toBe('string');

        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const claims = await verifyJwt(token!, keyring);
        expect(claims['sub']).toBe(OWNER_ID);
        expect(claims['custom:tenantId']).toBe(TENANT_ID);
    });

    it('does NOT put the JWT in the body for a caller without the header, and still sets the cookie', { timeout: 60_000 }, async () => {
        await withPassword();
        const res = await call(h, '/api/auth/login', postJson({ email: EMAIL, password: PASSWORD }));
        const text = await res.text();
        expect(res.status, text).toBe(200);
        const raw = JSON.parse(text) as { data: Record<string, unknown> };
        // Asserted on the raw body, before any schema parse touches it.
        expect(raw.data, 'a browser must never be handed the JWT').not.toHaveProperty('token');
        expect(LoginResponseSchema.parse(raw).data).toEqual({ redirect: '/inspections' });
        expect(res.headers.get('set-cookie') ?? '').toMatch(/__Host-inspector_token=[^;]+/);
    });
});
