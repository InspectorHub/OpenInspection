/**
 * The auth router answers at ONE address: `/api/auth`.
 *
 * It used to be mounted twice — at `/api/auth` AND at `/` — so every auth
 * endpoint had a second, undocumented address (`POST /login`, `POST /setup`,
 * `POST /join`, `GET /me`, the whole 2FA sub-router …). Two addresses for one
 * handler is two things to remember in every middleware allowlist, and the
 * root copies were the ones nobody listed.
 *
 * Exactly one auth path has to answer at the root: `GET /sso`. The portal
 * mints an ABSOLUTE `https://app.{domain}/sso?code=<code>` and the browser
 * navigates straight to it, so that address is minted outside this repo and
 * cannot be moved by editing this repo. It is now registered on its own
 * (`ssoRootRoutes`) instead of dragging the rest of the router along with it.
 *
 * The assertions read the LIVE route table, not just the source: a source grep
 * cannot see a second address that arrives through some other mount, and a
 * spec that only reads source would stay green if the mount moved elsewhere.
 * Every negative assertion is paired with a positive control.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../../../server/index';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const index = read('server', 'index.ts');
const suspendGuard = read('server', 'lib', 'middleware', 'tenant-status-guard.ts');

const registered = (method: string) =>
    app.routes.filter((r) => r.method === method).map((r) => r.path);

// Root duplicates the old `.route('/', coreAuthRoutes)` used to create.
const ROOT_DUPLICATES = [
    '/login',
    '/join',
    '/setup',
    '/logout',
    '/change-password',
    '/forgot-password',
    '/reset-password',
];

describe('coreAuthRoutes is mounted exactly once', { timeout: 30_000 }, () => {
    it('mounts it at /api/auth', () => {
        expect(index).toContain(`.route('/api/auth', coreAuthRoutes)`);
        // Positive control for every negative assertion below: the canonical
        // address must exist, or "not at the root" is vacuously true.
        expect(registered('POST')).toContain('/api/auth/login');
    });

    it('does not also mount the whole router at the root', () => {
        const posts = registered('POST');
        for (const dup of ROOT_DUPLICATES) {
            expect(posts, `POST ${dup} still answers at the root`).not.toContain(dup);
        }
        expect([...index.matchAll(/\.route\('\/',\s*coreAuthRoutes\)/g)]).toHaveLength(0);
        // GET /setup is NOT in that list: it belongs to setupWizardRoutes,
        // which is mounted at /setup in its own right and stays.
        expect(registered('GET')).toContain('/setup');
    });

    it('still serves GET /sso as its own route', () => {
        expect(registered('GET')).toContain('/sso');
        expect(index).toContain(`.route('/', ssoRootRoutes)`);
    });

    it('keeps the canonical /api/auth/sso address as well', () => {
        // The root registration is an addition, not a move: the tests and
        // clients that call the API-canonical address keep working.
        expect(registered('GET')).toContain('/api/auth/sso');
    });

    it('keeps /sso exempt from the suspended-tenant guard', () => {
        // /sso is not under /api/auth, so the guard's `/api/auth/` prefix does
        // not cover it. Losing this entry would throw TenantSuspended on the
        // handoff instead of landing the user.
        expect(suspendGuard).toContain(`'/sso'`);
    });
});
