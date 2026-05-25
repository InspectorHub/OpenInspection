import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Booking #7 Sprint A — verify the `/book/<slug>` route ships and the
 * first-inspector-wins fallback in `bookings.ts` is removed.
 *
 * Source-text assertions are intentionally cheap to maintain compared with a
 * full Hono runtime fixture; the dynamic behavior is validated by the
 * UserService tests (Task 3) plus Playwright once the dev server runs.
 */
describe('Booking — slug-based routing', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const indexSrc = fs.readFileSync(path.join(repoRoot, 'src/index.ts'), 'utf8');
    const bookingsSrc = fs.readFileSync(path.join(repoRoot, 'src/api/bookings.ts'), 'utf8');

    it('mounts /book/:tenant/:slug route', () => {
        // PR 2 T2 — path-param tenant routing replaced the host-only signature.
        expect(indexSrc).toMatch(/['"`]\/book\/:tenant\/:slug['"`]/);
    });

    it('imports BookingNotFoundPage and BookingNoSlugLandingPage', () => {
        expect(indexSrc).toMatch(/BookingNotFoundPage/);
        expect(indexSrc).toMatch(/BookingNoSlugLandingPage/);
    });

    it('drops the first-inspector-wins fallback in bookings.ts', () => {
        // The legacy block called `users` directly with no inspector context.
        // Make sure no select-from-users-limit-1 fallback remains.
        const fallback = /from\(users\)\s*\.where\(eq\(users\.tenantId, tenantId\)\)\s*\.limit\(1\)/;
        expect(fallback.test(bookingsSrc)).toBe(false);
    });

    it('rejects bookings without inspectorId in the request body', () => {
        // The BadRequest message we ship calls out the missing context so
        // customers know to use their inspector's link.
        expect(bookingsSrc).toMatch(/Booking link missing inspector context/);
    });

    it('exports the soft-landing pages from templates/pages', () => {
        const notFoundPath = path.join(repoRoot, 'src/templates/pages/booking-not-found.tsx');
        const noSlugPath = path.join(repoRoot, 'src/templates/pages/booking-no-slug.tsx');
        expect(fs.existsSync(notFoundPath)).toBe(true);
        expect(fs.existsSync(noSlugPath)).toBe(true);

        const notFoundSrc = fs.readFileSync(notFoundPath, 'utf8');
        const noSlugSrc = fs.readFileSync(noSlugPath, 'utf8');
        expect(notFoundSrc).toMatch(/BookingNotFoundPage/);
        expect(noSlugSrc).toMatch(/BookingNoSlugLandingPage/);
    });
});
