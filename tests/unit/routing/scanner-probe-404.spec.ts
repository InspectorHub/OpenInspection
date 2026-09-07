/**
 * The cheap-404 pattern for vulnerability-scanner probes.
 *
 * WHY IT EXISTS: those paths otherwise reach the SSR catch-all, and the 404 page
 * is a real React Router render. Measured in production over 15h: /.env cost
 * 200ms of CPU, /config/.env 89ms, /backend/.env 87ms, /wordpress/ 172ms —
 * roughly what a real page costs, on a worker whose ceiling is 10ms per
 * invocation.
 *
 * WHY THIS TEST EXISTS: the failure mode of a denylist is not a missed probe,
 * it is a FALSE POSITIVE — a real page turned into a bare 404 with nothing to
 * explain it. So the second case below reads `app/routes.ts` and asserts the
 * pattern matches NONE of the paths the app actually declares. That is checked
 * against the route table itself rather than a list retyped here, because a list
 * I wrote by hand would agree with the pattern I wrote by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** The pattern, read from the worker entry so the two cannot drift apart. */
const SRC = readFileSync(new URL('../../../workers/app.ts', import.meta.url), 'utf8');
const literal = /const SCANNER_PROBE =\s*(\/.*\/[gimsuy]*);/s.exec(SRC)?.[1];

function buildPattern(): RegExp {
    if (!literal) throw new Error('SCANNER_PROBE literal not found in workers/app.ts');
    const body = literal.slice(1, literal.lastIndexOf('/'));
    const flags = literal.slice(literal.lastIndexOf('/') + 1);
    return new RegExp(body, flags);
}

describe('scanner probe fast-404', () => {
    it('matches the probes actually seen in production', () => {
        const re = buildPattern();
        // Every one of these was observed hitting production, or is the same
        // scanner's neighbouring wordlist entry.
        for (const p of [
            '/.env', '/config/.env', '/backend/.env', '/.env.local',
            '/wordpress/', '/wp-admin/', '/wp-login.php', '/wp-content/x.php',
            '/.git/config', '/phpmyadmin/', '/index.php', '/dump.sql',
            '/cgi-bin/test', '/.aws/credentials', '/backup.bak',
        ]) {
            expect(re.test(p), `should be treated as a probe: ${p}`).toBe(true);
        }
    });

    it('matches NONE of the paths app/routes.ts declares', () => {
        const re = buildPattern();
        const routes = readFileSync(new URL('../../../app/routes.ts', import.meta.url), 'utf8');
        // `route("some/path", …)` and `index(…)`; the first string argument is
        // the URL path. Params (:id) are replaced with a plausible value.
        const declared = [...routes.matchAll(/\broute\(\s*"([^"]*)"/g)].map((m) => m[1] ?? '');
        // The instrument must actually have found the route table.
        expect(declared.length, 'parsed zero routes from app/routes.ts — the matcher is broken, not the routes clean').toBeGreaterThan(50);

        for (const raw of declared) {
            const path = '/' + raw.replace(/:[A-Za-z0-9_]+/g, 'sample-value').replace(/^\/+/, '');
            expect(re.test(path), `real route must NOT be treated as a probe: ${path}`).toBe(false);
        }
    });

    it('leaves ordinary typos to the app, which still renders a real 404', () => {
        const re = buildPattern();
        for (const p of ['/inspectionz', '/setting', '/report', '/robots.txt', '/sitemap.xml', '/assets/app-AbC123.js']) {
            expect(re.test(p), `should fall through to SSR: ${p}`).toBe(false);
        }
    });
});
