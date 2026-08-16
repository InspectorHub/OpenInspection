/**
 * Who has to solve a bot challenge, and who decides.
 *
 * The rule this pins was ruled on twice. The portal version came first
 * (2026-06-05): a bot challenge must never have a "nobody configured it, so it
 * is off" bypass, because that branch silently disables a security mechanism
 * and nothing about the running system says so. The engine had exactly that
 * bypass at both of its anonymous-submission surfaces until 2026-08-16.
 *
 * The extension, ruled 2026-08-16: it binds SAAS. A standalone deployment is
 * somebody else's server on somebody else's domain, and a single-company
 * install behind a private URL has a legitimate reason not to challenge
 * anyone — so there the operator decides.
 *
 * These specs are on the POLICY, not on a route, because the policy is the
 * thing that used to be duplicated as an `if` at each call site. Two copies of
 * a security condition is how one of them ends up missing the next rule.
 */
import { describe, it, expect } from 'vitest';
import {
    resolveTurnstile, resolveTurnstileSiteKey,
    TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_SITE_KEY,
} from '../../../server/lib/middleware/bot-protection';

const SAAS = { APP_MODE: 'saas' };
const STANDALONE = { APP_MODE: 'standalone' };

describe('saas always challenges', () => {
    it('uses the configured secret when there is one', () => {
        const p = resolveTurnstile({ ...SAAS, TURNSTILE_SECRET_KEY: '0x-real-secret' });
        expect(p).toEqual({ enforced: true, secret: '0x-real-secret', usingTestKey: false });
    });

    it('falls back to the published test key rather than skipping', () => {
        // 🔴 The whole ruling. Before this, an unconfigured saas deployment left
        // the public booking form and agent signup open to anything.
        const p = resolveTurnstile(SAAS);
        expect(p.enforced).toBe(true);
        expect(p.secret).toBe(TURNSTILE_TEST_SECRET_KEY);
        expect(p.usingTestKey).toBe(true);
    });

    it('treats whitespace as unconfigured', () => {
        // An env var set to an empty string is a common deploy accident, and it
        // must not read as "a secret is present" — that would enforce against a
        // secret Cloudflare rejects, refusing every real visitor.
        const p = resolveTurnstile({ ...SAAS, TURNSTILE_SECRET_KEY: '   ' });
        expect(p.secret).toBe(TURNSTILE_TEST_SECRET_KEY);
        expect(p.usingTestKey).toBe(true);
    });
});

describe('standalone leaves it to the operator', () => {
    it('enforces when the operator configured a secret', () => {
        const p = resolveTurnstile({ ...STANDALONE, TURNSTILE_SECRET_KEY: '0x-real-secret' });
        expect(p).toEqual({ enforced: true, secret: '0x-real-secret', usingTestKey: false });
    });

    it('does not challenge when they did not', () => {
        expect(resolveTurnstile(STANDALONE)).toEqual({ enforced: false, secret: '', usingTestKey: false });
    });

    it('defaults to standalone when APP_MODE is absent', () => {
        // The default has to be the permissive one: a bare `npm run dev` and a
        // fresh self-host both arrive here, and neither is the platform.
        expect(resolveTurnstile({}).enforced).toBe(false);
    });
});

describe('the site key tracks the secret', () => {
    it('serves the test site key exactly when the test secret is in use', () => {
        // These two must move together. A page that renders no widget against a
        // server demanding a token is a booking form nobody can submit — a
        // self-inflicted outage, and the failure mode of resolving them apart.
        expect(resolveTurnstileSiteKey(SAAS)).toBe(TURNSTILE_TEST_SITE_KEY);
        expect(resolveTurnstile(SAAS).secret).toBe(TURNSTILE_TEST_SECRET_KEY);
    });

    it('prefers the operator\'s own site key', () => {
        expect(resolveTurnstileSiteKey({ ...SAAS, TURNSTILE_SITE_KEY: '0x-real-site' })).toBe('0x-real-site');
    });

    it('serves nothing when no challenge applies', () => {
        // null, not the test key: standalone-unconfigured renders no widget at
        // all, and handing the page a key would make it draw one whose token
        // the server will never ask for.
        expect(resolveTurnstileSiteKey(STANDALONE)).toBeNull();
    });

    it('never returns a key while enforcement is off, or nothing while it is on', () => {
        // The invariant behind the three specs above, stated once so a future
        // fourth case cannot satisfy them individually and still break it.
        for (const env of [SAAS, STANDALONE, {}, { ...SAAS, TURNSTILE_SECRET_KEY: 'x' }]) {
            const enforced = resolveTurnstile(env).enforced;
            const siteKey = resolveTurnstileSiteKey(env);
            expect(enforced === (siteKey !== null), JSON.stringify(env)).toBe(true);
        }
    });
});
