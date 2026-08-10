import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The zone tables must stay out of the cheap module (#99).
 *
 * ── Why a source-reading test and not a behavioural one ──
 * The thing being protected is a MODULE BOUNDARY, and crossing it produces no
 * behaviour to assert on. A single `import { TIMEZONE_SELECT_OPTIONS } from
 * './timezones'` added anywhere in the cheap path would put 419
 * `Intl.DateTimeFormat` constructions back into every public page's hydration —
 * every render identical, every existing test still green, and the only symptom
 * a few hundred milliseconds on someone else's phone.
 *
 * That is exactly the shape of defect nothing in this repo would have caught, so
 * the guard has to read the imports.
 *
 * The rule: `timezones.ts` holds cheap primitives; `timezone-options.ts` (all
 * 419, Settings) and `timezone-options-public.ts` (curated, public) are separate
 * leaves. Nothing cheap may import a leaf, and the leaves may not import each
 * other — putting both tables in reach of one import is the same defect wearing
 * a different filename.
 */

const APP = join(process.cwd(), 'app');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

/** Static `import ... from '<specifier>'` only — a dynamic import() is the point. */
const staticImportsOf = (src: string): string[] =>
    [...src.matchAll(/^\s*import\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const TABLE_MODULES = ['timezone-options', 'timezone-options-public'];
const hitsTable = (spec: string) =>
    TABLE_MODULES.some((t) => spec === `./${t}` || spec.endsWith(`/lib/${t}`));

describe('timezone module boundaries', () => {
    it('the guard can see imports at all', () => {
        // Anti-vacuity. If the matcher silently stopped parsing, every assertion
        // below would pass by finding nothing — the failure mode this whole file
        // exists to prevent, reproduced in the file itself.
        const specs = staticImportsOf(read('lib/timezone-options.ts'));
        expect(specs, 'parsed no imports out of a file that has one').toContain('./timezones');
    });

    it('timezones.ts pulls in neither table', () => {
        // It is imported by viewer-timezone.tsx, which every public report page
        // reaches. A module's scope runs in full for any import of it, so one
        // import here is all 419 zones on every public page again.
        const specs = staticImportsOf(read('lib/timezones.ts'));
        expect(specs.filter(hitsTable)).toEqual([]);
    });

    it('viewer-timezone.tsx pulls in neither table', () => {
        const specs = staticImportsOf(read('lib/viewer-timezone.tsx'));
        expect(specs.filter(hitsTable)).toEqual([]);
    });

    it('the two tables do not import each other', () => {
        // Separate modules are the entire mechanism. Merging them — or having one
        // re-export the other — would mean the public pages load all 419 zones to
        // read the curated 90.
        expect(staticImportsOf(read('lib/timezone-options.ts')).filter((s) =>
            s.includes('timezone-options-public'),
        )).toEqual([]);
        expect(staticImportsOf(read('lib/timezone-options-public.ts')).filter((s) =>
            s.includes('timezone-options') && !s.includes('public'),
        )).toEqual([]);
    });

    it('public routes reach the control only through the lazy wrapper', () => {
        // Importing ViewerTimeZoneNotice directly re-attaches its chunk to the
        // route, which is the cost the wrapper exists to avoid — and it would
        // still render correctly, so nothing else would object.
        for (const route of ['routes/public/verify.tsx', 'routes/public/concierge-confirm-token.tsx']) {
            const specs = staticImportsOf(read(route));
            expect(
                specs.filter((s) => s.endsWith('/ViewerTimeZoneNotice')),
                `${route} imports the control statically; use LazyViewerTimeZoneNotice`,
            ).toEqual([]);
            expect(specs.filter(hitsTable), `${route} imports a zone table directly`).toEqual([]);
        }
    });

    it('the lazy wrapper loads the control dynamically, not statically', () => {
        const src = read('components/public/LazyViewerTimeZoneNotice.tsx');
        expect(src).toMatch(/import\(\s*["'][^"']*ViewerTimeZoneNotice["']\s*\)/);
        expect(staticImportsOf(src).filter((s) => s.endsWith('/ViewerTimeZoneNotice'))).toEqual([]);
    });
});
