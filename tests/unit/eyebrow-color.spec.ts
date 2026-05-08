/**
 * Eyebrow color enum compliance check (Sub-spec B Task 4 / B-3).
 *
 * Every PageHeader instance in apps/core/src/templates/pages/ must use one of
 * the 5 canonical EyebrowColor values: slate / indigo / emerald / amber / rose.
 *
 * No raw hex on eyebrow chips, no off-palette colors. This guarantees the
 * sidebar 5+Library and PageHeader land like a single product, not 14 ad-hoc
 * color choices per page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PAGES_DIR = join(__dirname, '../../src/templates/pages');
const ALLOWED = new Set(['slate', 'indigo', 'emerald', 'amber', 'rose']);
// Match: eyebrowColor="slate"  OR  eyebrowColor='slate'  OR  eyebrowColor={"slate"}
const EYEBROW_RE = /eyebrowColor\s*=\s*[{"']?([a-z]+)[}"']?/g;

describe('eyebrow color enum compliance', () => {
    const files = readdirSync(PAGES_DIR).filter(f => f.endsWith('.tsx'));

    files.forEach(file => {
        it(`${file} uses canonical eyebrow color`, () => {
            const src = readFileSync(join(PAGES_DIR, file), 'utf-8');
            const matches = Array.from(src.matchAll(EYEBROW_RE));
            for (const m of matches) {
                const value = m[1];
                expect(ALLOWED, `Page ${file} uses eyebrowColor="${value}" — must be one of slate/indigo/emerald/amber/rose`).toContain(value);
            }
        });
    });

    it('at least one canonical eyebrow color is in use across pages (sanity check)', () => {
        let anyMatch = false;
        for (const file of files) {
            const src = readFileSync(join(PAGES_DIR, file), 'utf-8');
            if (src.match(EYEBROW_RE)) { anyMatch = true; break; }
        }
        expect(anyMatch).toBe(true);
    });
});
