/**
 * `/ui` is anonymous and renders identically for everyone, so every SSR render it
 * performs is one an unauthenticated caller asked for and nobody needed.
 *
 * It sits beside `/doc` on the list of public endpoints that cost CPU, and it is
 * the cheap half — a page render rather than the ~1s OpenAPI build. The load is
 * removed by letting the edge hold it, which is only possible because the route
 * reads nothing per-request. That last part is the fragile half, so it is
 * asserted: the day someone adds a loader, caching the response becomes wrong and
 * this test is where that gets noticed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headers, meta, links } from './docs';

describe('/ui is cacheable because it is the same for everyone', () => {
    it('lets the edge hold the page', () => {
        const h = new Headers(headers() as HeadersInit);
        expect(h.get('Cache-Control')).toMatch(/public/);
        expect(h.get('Cache-Control')).toMatch(/max-age=\d+/);
    });

    it('still exports the meta and links it had, so the cache header did not replace them', () => {
        // Positive control. A route module that failed to load at all would make
        // the assertion above throw rather than fail, and a reader of the output
        // would not be able to tell those apart.
        expect(meta()).toEqual([{ title: expect.any(String) }]);
        expect(links()).toEqual([{ rel: 'stylesheet', href: '/vendor/swagger-ui.css' }]);
    });

    it('has no loader, which is the premise the cache header rests on', () => {
        // A loader would make the response per-request, and a shared cache over a
        // per-request response is how one visitor is served another's page. The
        // header above is only safe while this stays true, so it is pinned here
        // rather than left as an assumption in a comment.
        const src = readFileSync(join(__dirname, 'docs.tsx'), 'utf8');
        expect(src).not.toMatch(/export\s+(async\s+)?function\s+loader/);
        expect(src).not.toMatch(/export\s+const\s+loader/);
        // And no action either — a cached GET is fine, but an action here would
        // mean the route does something per-caller after all.
        expect(src).not.toMatch(/export\s+(async\s+)?function\s+action/);
    });
});
