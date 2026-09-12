/**
 * `GET /doc` is public, unauthenticated, and costs about a second of CPU on a
 * cold isolate against a 10ms ceiling. Its own comment calls it a
 * denial-of-service primitive pointed at the whole worker.
 *
 * Three properties keep that from being a free lever, and none of them is
 * visible in the response body — the memoization is invisible by construction
 * (it only shows up as the SECOND request being fast), and a missing rate limit
 * looks exactly like a rate limit nobody has tripped yet. So they are asserted
 * against the source, which is where they can be deleted.
 *
 * ⚠️ The ORDER of two of them is load-bearing, not cosmetic. Rate limiting after
 * the build pays the CPU and then declines to hand over what it cost, which is
 * the expensive half of the request done for nothing — so the order is asserted
 * rather than just the presence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '../../../server/index.ts'), 'utf8');

/**
 * The handler body, sliced out so a `checkRateLimit` call somewhere else in this
 * 500-line file cannot satisfy the assertions below. Sliced from the route
 * registration rather than searched for by name, because the thing being checked
 * is what THIS route does.
 */
const HANDLER_START = SRC.indexOf("app.get('/doc'");
const docHandler = SRC.slice(HANDLER_START, HANDLER_START + 900);

describe('the OpenAPI document cannot be used as a CPU lever', () => {
    it('is registered at all, so the slice above is not empty', () => {
        // The failure this prevents: every assertion below trivially passing
        // against an empty string after the route is renamed or moved.
        expect(HANDLER_START).toBeGreaterThan(-1);
        expect(docHandler.length).toBeGreaterThan(100);
    });

    it('is still memoized per isolate', () => {
        // The `??=` is what makes a warm isolate cheap. Losing it would put the
        // full build on EVERY request rather than one per isolate.
        expect(docHandler).toMatch(/openApiDocument \?\?=/);
    });

    it('rate limits BEFORE it builds', () => {
        expect(docHandler).toMatch(/checkRateLimit\(c, 'openapi-doc'\)/);
        expect(docHandler.indexOf('checkRateLimit'))
            .toBeLessThan(docHandler.indexOf('openApiDocument ??='));
    });

    it('tells the edge it may hold the document', () => {
        // Identical for every caller, changes only on deploy. Without this the
        // edge revalidates every hit and the per-isolate memoization is the only
        // defence left — and the lever this endpoint offers is arranging for
        // cold isolates, which memoization does nothing about.
        expect(docHandler).toMatch(/Cache-Control/);
        expect(docHandler).toMatch(/max-age=\d+/);
    });

    it('uses the shared limiter rather than a local function of the same name', () => {
        // Positive control. Every assertion above is a source grep, and a grep
        // is satisfied by a no-op stub called `checkRateLimit` defined two lines
        // up. This pins it to the module that actually talks to the binding.
        expect(SRC).toMatch(/import \{[^}]*checkRateLimit[^}]*\} from '\.\/lib\/rate-limit'/);
    });

    it('the shared limiter still fails OPEN without a binding, which is why the header matters', () => {
        // Read from the limiter itself, not restated. `checkRateLimit` no-ops
        // when `RATE_LIMITER` is absent — correct for local dev, and the reason
        // the cache header is not redundant with it: on a deployment with no
        // binding provisioned, the header is the only mitigation in place.
        const limiter = readFileSync(
            join(__dirname, '../../../server/lib/rate-limit.ts'),
            'utf8',
        );
        expect(limiter).toMatch(/if \(!c\.env\.RATE_LIMITER\)\s*return/);
    });
});
