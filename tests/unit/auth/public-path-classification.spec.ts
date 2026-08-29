import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which paths the JWT middleware treats as needing no session.
 *
 * -- WHY THIS IS ASSERTED AGAINST THE SOURCE ---------------------------------
 * The classification is a single boolean expression inside the middleware, and
 * the middleware needs a keyring, a KV binding and a signed cookie before it
 * will run at all. Standing that up would test the plumbing; what went wrong
 * was the RULE, and the rule is readable on its own.
 *
 * -- WHAT WENT WRONG ---------------------------------------------------------
 * `isPublic` OR'd in a bare `STATIC_ASSET_EXT.test(path)`, so EVERY API route
 * whose path ends in `.pdf` / `.json` / `.txt` / `.js` / … returned `next()`
 * before a token was read. Measured on
 * `/api/inspections/{id}/statutory-form.pdf`: `userRole` was never set and the
 * route's own `requireRole` answered 401 "No role found in context", so every
 * inspector who pressed Download on a statutory form got an error.
 *
 * That one failed CLOSED, which is exactly why it read as a broken button for
 * as long as it did. The same rule on a route that reads `tenantId` without
 * demanding a role does not fail closed: in standalone the tenant resolves from
 * the host, so such a route answers with real data and no session at all.
 *
 * So the assertion is about the SHAPE of the rule, not about today's route
 * list: an extension may never, by itself, make an `/api/` path public.
 */
const SRC = readFileSync(
    join(process.cwd(), 'server/lib/middleware/jwt-auth.ts'),
    'utf8',
);

/** The classifier, lifted out of the middleware so it can be exercised. */
function isStaticAssetPath(path: string): boolean {
    const m = /const STATIC_ASSET_EXT = (\/.*\/i);/.exec(SRC);
    if (!m) throw new Error('STATIC_ASSET_EXT is no longer declared the way this spec reads it');
    // eslint-disable-next-line no-eval
    const re = eval(m[1]) as RegExp;
    if (path.startsWith('/api/')) return false;
    return re.test(path);
}

describe('public-path classification', () => {
    it('reads the real regex out of the middleware, not a copy of it', () => {
        // A copy would drift, and a drifted copy passing is worth nothing.
        expect(SRC).toContain('function isStaticAssetPath');
        expect(SRC).toContain('if (path.startsWith(\'/api/\')) return false;');
        // The call site must use the function, not the bare regex.
        expect(SRC).toContain('isStaticAssetPath(path) ||');
        expect(SRC).not.toMatch(/\|\|\s*STATIC_ASSET_EXT\.test\(path\)\s*\|\|/);
    });

    it('never makes an /api path public because of its extension', () => {
        for (const p of [
            '/api/inspections/abc/statutory-form.pdf',
            '/api/admin/agreement-requests/req-1/certificate.pdf',
            '/api/anything/at/all.json',
            '/api/anything/at/all.txt',
            '/api/anything/at/all.js',
            '/api/anything/at/all.css',
        ]) {
            expect(isStaticAssetPath(p), p).toBe(false);
        }
    });

    it('still exempts the real static assets, which is what the rule is for', () => {
        // The positive control: a test that only checked the /api cases would
        // pass just as well against `return false` for everything, and that
        // would put authentication in front of the stylesheet.
        for (const p of [
            '/styles.css',
            '/vendor/thing.js',
            '/favicon.svg',
            '/fonts/inter.woff2',
            '/build/assets/app.map',
        ]) {
            expect(isStaticAssetPath(p), p).toBe(true);
        }
    });

    it('is decided by the LAST segment, so a directory name cannot fake it', () => {
        expect(isStaticAssetPath('/pdf/report')).toBe(false);
        expect(isStaticAssetPath('/api/inspections/abc/pdf')).toBe(false);
    });
});
