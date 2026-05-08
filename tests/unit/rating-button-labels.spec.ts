/**
 * R7-16 — Rating buttons render the full label on tablet+ (≥640px) and the
 * abbreviation only on mobile, with `aria-label` always carrying the full
 * name for assistive tech.
 *
 * The buttons are produced by an Alpine `x-for` over `ratingLevels`, so we
 * cannot assert `toHaveAccessibleName('Satisfactory')` in Playwright without
 * loading a real, fully-seeded inspection in a logged-in browser context —
 * that's beyond the scope of this responsive labelling fix.
 *
 * Instead we statically verify the JSX template:
 *   * each rating-row template renders TWO <span> siblings, one with
 *     `class="hidden sm:inline"` + `x-text="level.label"` (full name on
 *     tablet+) and one with `class="sm:hidden"` + `x-text="level.abbreviation"`
 *     (abbrev on mobile)
 *   * each <button> still binds `aria-label` to `level.label` so screen
 *     readers always announce the full name regardless of viewport
 *
 * If a future refactor regresses the responsive label or drops aria-label,
 * this spec fails before the regression reaches CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxPath = resolve(__dirname, '../../src/templates/pages/inspection-edit.tsx');
const source  = readFileSync(tsxPath, 'utf8');

describe('R7-16 — rating button responsive labels', () => {
    it('renders both full-label (sm:inline) and abbreviation (sm:hidden) spans', () => {
        // Both spans must appear at least twice: the desktop top-bar button
        // row and the active-card row both render rating buttons.
        const fullLabelMatches = source.match(/class="hidden sm:inline" x-text="level\.label"/g) ?? [];
        const abbrevMatches    = source.match(/class="sm:hidden" x-text="level\.abbreviation"/g) ?? [];
        expect(fullLabelMatches.length, 'full-label span (hidden sm:inline) should appear in at least 2 rating rows').toBeGreaterThanOrEqual(2);
        expect(abbrevMatches.length,    'abbrev span (sm:hidden) should appear in at least 2 rating rows').toBeGreaterThanOrEqual(2);
    });

    it('keeps aria-label bound to level.label on every rating button', () => {
        // x-bind:aria-label="level.label" — must remain on the rating buttons
        // so AT users always hear the full rating name.
        const aria = source.match(/x-bind:aria-label="level\.label"/g) ?? [];
        expect(aria.length, 'aria-label="level.label" must be present on rating buttons').toBeGreaterThanOrEqual(2);
    });

    it('removes the old single x-text="level.abbreviation" attribute from rating buttons', () => {
        // The previous code rendered the button as <button x-text="level.abbreviation">
        // which left no room for a full-label fallback. Confirm we no longer
        // attach x-text directly to the rating <button> tag (the spans inside
        // each button are still allowed — that match is excluded by the
        // negative lookbehind on `class="sm:hidden" `).
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            // Only flag <button>-tag lines that use the old single-x-text
            // pattern — span-tag lines are part of the new pattern and OK.
            if (/^\s*x-text="level\.abbreviation"\s*$/.test(line)) {
                // Walk up to find the enclosing tag start.
                let opener = '';
                for (let j = i; j >= 0 && j > i - 12; j--) {
                    const lj = lines[j] ?? '';
                    if (/^\s*<button\b/.test(lj)) { opener = '<button'; break; }
                    if (/^\s*<span\b/.test(lj))   { opener = '<span';   break; }
                }
                expect(opener, `line ${i + 1} attaches x-text=level.abbreviation directly to a <button>`).not.toBe('<button');
            }
        }
    });
});
