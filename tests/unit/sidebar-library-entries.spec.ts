/**
 * Iter-2 bug #8 — sidebar Library group must include all seven entries
 * (both mobile drawer + desktop aside) in the canonical order:
 *   Inspection Templates / Marketplace / Comments / Repair Items / Tags /
 *   Agreements / Rating Systems
 *
 * Static check on main-layout.tsx so a future PR can't drop or reorder
 * an entry without flipping this test.
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

const EXPECTED_ORDER = [
    { label: 'Inspection Templates',  href: '/templates' },
    { label: 'Marketplace',           href: '/marketplace' },
    { label: 'Comments',              href: '/comments' },
    { label: 'Repair Items',          href: '/recommendations' },
    { label: 'Tags',                  href: '/library/tags' },
    { label: 'Agreements',            href: '/agreements' },
    { label: 'Rating Systems',        href: '/library/rating-systems' },
];

describe('iter-2 bug #8 — sidebar Library entries', () => {
    // Both copies of the menu (mobile drawer + desktop aside) live inside
    // the same source file. Walk through every `data-sidebar-library`
    // occurrence and keep only the ones that sit inside a real <details>
    // tag (vs. the activate-sidebar querySelector string).
    const blocks: string[] = [];
    let cursor = 0;
    while (true) {
        const idx = layoutSrc.indexOf('data-sidebar-library', cursor);
        if (idx < 0) break;
        cursor = idx + 1;
        // Skip the script-string occurrence (sits inside a JS string literal).
        const before = layoutSrc.slice(Math.max(0, idx - 60), idx);
        if (!before.includes('<details')) continue;
        // Capture until the closing </details> for this block.
        const end = layoutSrc.indexOf('</details>', idx);
        if (end < 0) continue;
        blocks.push(layoutSrc.slice(idx, end));
    }

    it('renders the Library group twice (mobile drawer + desktop aside)', () => {
        expect(blocks.length).toBe(2);
    });

    for (let i = 0; i < blocks.length; i++) {
        const which = i === 0 ? 'mobile drawer' : 'desktop aside';
        it(`${which} — every entry present`, () => {
            const scoped = blocks[i] ?? '';
            for (const { label, href } of EXPECTED_ORDER) {
                expect(scoped, `${which} missing href ${href}`).toContain(`href="${href}"`);
                expect(scoped, `${which} missing label ${label}`).toContain(`>${label}<`);
            }
        });

        it(`${which} — entries appear in canonical order`, () => {
            const scoped = blocks[i] ?? '';
            const positions = EXPECTED_ORDER.map((e) => scoped.indexOf(`href="${e.href}"`));
            for (let j = 1; j < positions.length; j++) {
                expect(
                    positions[j],
                    `${which} — ${EXPECTED_ORDER[j]?.label} should come after ${EXPECTED_ORDER[j - 1]?.label}`,
                ).toBeGreaterThan(positions[j - 1] ?? -1);
            }
        });
    }
});
