/**
 * Sidebar Library group — all seven entries present in canonical order.
 *
 * Updated for Design System 0523 compaction: Library is now a flat group
 * with an eyebrow label (no <details> wrapper). Both mobile drawer and
 * desktop sidebar render the same entries.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const layoutSrc = readFileSync(
    resolve(__dirname, '../../src/templates/layouts/main-layout.tsx'),
    'utf8',
);

const EXPECTED_HREFS = [
    '/templates',
    '/marketplace',
    '/comments',
    '/recommendations',
    '/library/tags',
    '/agreements',
    '/library/rating-systems',
];

describe('sidebar Library entries', () => {
    it('all library hrefs present in layout source', () => {
        for (const href of EXPECTED_HREFS) {
            expect(layoutSrc, `missing href ${href}`).toContain(`href="${href}"`);
        }
    });

    it('library entries appear in canonical order', () => {
        const positions = EXPECTED_HREFS.map(h => layoutSrc.indexOf(`href="${h}"`));
        for (let i = 1; i < positions.length; i++) {
            expect(
                positions[i],
                `${EXPECTED_HREFS[i]} should come after ${EXPECTED_HREFS[i - 1]}`,
            ).toBeGreaterThan(positions[i - 1] ?? -1);
        }
    });

    it('LIBRARY eyebrow label present', () => {
        expect(layoutSrc).toContain('>Library<');
    });
});
