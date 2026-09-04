/**
 * Two-factor sign-in, end to end against the seeded standalone worker.
 *
 * STANDALONE IS THE POINT, not a convenience. In SaaS the engine has no local
 * login — `GET /login` 302s to the portal and `POST /api/auth/login` answers
 * 410 LOGIN_MOVED_TO_PORTAL — so this challenge is unreachable there. Standalone
 * is the deployment where the engine's own login page is the only door, and
 * therefore the one where getting this wrong locks an operator out of their own
 * self-hosted install with no portal to go round by.
 *
 * That is what this spec exists to prevent. `server/api/auth.ts` has answered a
 * 2FA account's correct password with a five-minute challenge token since 2FA
 * was written, and `app/routes/login.tsx` used to answer that challenge with
 * "2FA is not yet supported in the new frontend" — the server knew the password
 * was right, issued a challenge, and the only screen that could have answered
 * it refused.
 *
 * The TOTP codes here are computed from the secret the server just issued,
 * which is exactly what an authenticator app does with the same secret. The
 * account is enrolled and then DISABLED again, so the suite leaves the seeded
 * admin as it found it — a spec that leaves 2FA on would lock every later spec
 * out of the same account.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { TOTP, Secret } from 'otpauth';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const EMAIL = 'admin@autotest.com';
const PASSWORD = 'Password123!';

/** What an authenticator app would show for this secret, right now. */
const codeFor = (secret: string) =>
    new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

/**
 * POST, retried once when the dev worker restarts underneath the request.
 *
 * `wrangler dev` reloads after the build settles and answers anything in flight
 * with 503 "Your worker restarted mid-request… Only GET or HEAD requests are
 * retried automatically". That is infrastructure, not the API — but it arrives
 * as a 503, which reads exactly like a server fault, and it cost a debugging
 * round here before the response BODY was printed. A single retry on that one
 * message keeps the noise out without hiding a real 503: any other 503 is
 * returned untouched for the assertion to fail on.
 */
async function post(request: APIRequestContext, path: string, data: unknown, token?: string) {
    const send = () => {
        const { headers } = csrfHeaders();
        return request.post(`${BASE_URL}${path}`, {
            data,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
    };
    const first = await send();
    if (first.status() !== 503) return first;
    if (!(await first.text()).includes('restarted mid-request')) return first;
    return send();
}

const sessionFrom = (res: { headers(): Record<string, string> }) =>
    (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';

test.describe.configure({ mode: 'serial' });

test.describe('two-factor sign-in', () => {
    let secret = '';
    let recoveryCodes: string[] = [];
    let session = '';

    test('enrolling issues a secret, a QR and eight recovery codes', async ({ request }) => {
        const login = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        expect(login.status(), 'password-only login before 2FA').toBe(200);
        session = sessionFrom(login);
        expect(session, 'a session cookie was set').not.toBe('');

        const setup = await post(request, '/api/auth/2fa/setup', {}, session);
        expect(setup.status()).toBe(200);
        const body = await setup.json();
        secret = body.data.secret;
        recoveryCodes = body.data.recoveryCodes;

        expect(secret, 'a TOTP secret').toBeTruthy();
        // Eight is the count `generateRecoveryCodes` defaults to; a change there
        // is a change to how many times somebody can get back in.
        expect(recoveryCodes).toHaveLength(8);
        expect(body.data.qrCodeDataUri, 'a QR for the app to scan').toMatch(/^data:/);

        const verify = await post(request, '/api/auth/2fa/verify', { code: codeFor(secret) }, session);
        // The body, not just the status: a bare code tells you nothing about
        // which layer refused.
        expect(verify.status(), 'the code from that secret activates it: ' + (await verify.text()).slice(0, 300)).toBe(200);
    });

    test('the password alone now buys a CHALLENGE, not a session', async ({ request }) => {
        // The assertion this whole change exists for. Before it, this branch
        // answered "2FA is not yet supported" and the account was locked out.
        const res = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        expect(res.status()).toBe(200);
        const body = await res.json();

        expect(body.data.requires2fa, 'a challenge').toBe(true);
        expect(body.data.challengeToken, 'with a token to answer it').toBeTruthy();
        expect(body.data.token, 'and NO session until the second factor').toBeUndefined();
        expect(sessionFrom(res), 'not even as a cookie').toBe('');
    });

    test('answering the challenge completes the sign-in', async ({ request }) => {
        const login = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        const { challengeToken } = (await login.json()).data;

        const done = await post(request, '/api/auth/login/2fa', { challengeToken, code: codeFor(secret) });
        expect(done.status()).toBe(200);
        expect(sessionFrom(done), 'a real session cookie').not.toBe('');
    });

    test('a wrong code is refused WITHOUT spending the challenge', async ({ request }) => {
        // Dropping the challenge on a mistyped digit returns the person to the
        // password form, which reads as "your password was wrong" — a working
        // second factor reported as a broken login.
        const login = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        const { challengeToken } = (await login.json()).data;

        const bad = await post(request, '/api/auth/login/2fa', { challengeToken, code: '000000' });
        expect(bad.status(), 'a bad code is refused').toBe(401);

        const good = await post(request, '/api/auth/login/2fa', { challengeToken, code: codeFor(secret) });
        expect(good.status(), 'and the same challenge still works').toBe(200);
    });

    test('a recovery code signs in exactly once', async ({ request }) => {
        const rc = recoveryCodes[0]!;

        const first = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        const t1 = (await first.json()).data.challengeToken;
        const used = await post(request, '/api/auth/login/2fa', { challengeToken: t1, code: rc });
        expect(used.status(), 'a recovery code works').toBe(200);

        const second = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        const t2 = (await second.json()).data.challengeToken;
        const replay = await post(request, '/api/auth/login/2fa', { challengeToken: t2, code: rc });
        // The handler persists the remaining hashes BEFORE issuing the session,
        // so a failed write cannot leave a spent code usable.
        expect(replay.status(), 'the same one is refused the second time').toBe(401);
    });

    test('disabling needs the password AND a code, and restores password-only sign-in', async ({ request }) => {
        const login = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        const { challengeToken } = (await login.json()).data;
        const full = await post(request, '/api/auth/login/2fa', { challengeToken, code: codeFor(secret) });
        const token = sessionFrom(full);

        const noPassword = await post(request, '/api/auth/2fa/disable', { password: 'wrong-password', code: codeFor(secret) }, token);
        expect(noPassword.status(), 'a borrowed session cannot remove the second factor').toBe(401);

        const off = await post(request, '/api/auth/2fa/disable', { password: PASSWORD, code: codeFor(secret) }, token);
        expect(off.status()).toBe(200);

        const after = await post(request, '/api/auth/login', { email: EMAIL, password: PASSWORD });
        expect(after.status()).toBe(200);
        const body = await after.json();
        expect(body.data.requires2fa, 'no challenge any more').toBeUndefined();
        expect(sessionFrom(after), 'the password alone signs in again').not.toBe('');
    });
});
