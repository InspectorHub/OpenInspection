/**
 * Which image formats a credential badge may be uploaded in.
 *
 * A badge is composited over the report cover strip and beside the signature.
 * Both sit on the report's own surface, so a format with no alpha channel puts
 * the association logo inside a white rectangle — and in dark mode that
 * rectangle is the loudest thing on the page. JPEG cannot be transparent, so it
 * is not a badge format, however ordinary an image format it is elsewhere.
 *
 * The rule is asserted against the ROUTE SOURCE rather than through a mounted
 * request because the allowlist is a plain module constant: a spec that stood
 * up the whole OpenAPI router to read one array back would be testing Hono.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'server', 'api', 'credentials.ts'), 'utf8');

/** The `const ALLOWED = [...]` literal, as the route actually declares it. */
function allowlist(): string[] {
    const m = /const ALLOWED = \[([^\]]*)\]/.exec(SRC);
    if (!m) throw new Error('ALLOWED allowlist not found in server/api/credentials.ts');
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('credential badge upload formats', () => {
    it('accepts exactly the formats that can carry transparency', () => {
        expect(allowlist().sort()).toEqual(['image/png', 'image/svg+xml', 'image/webp']);
    });

    it('refuses JPEG — it has no alpha channel', () => {
        expect(allowlist()).not.toContain('image/jpeg');
    });

    it('tells the uploader why, rather than just listing formats', () => {
        // "must be png, svg, or webp" leaves someone holding a JPEG with no idea
        // what to do; naming the reason tells them to re-export instead.
        const message = /Errors\.BadRequest\('([^']*image must be[^']*)'\)/.exec(SRC)?.[1];
        expect(message).toBeDefined();
        expect(message).toMatch(/transparent/i);
        expect(message).not.toMatch(/jpe?g/i);
    });
});
