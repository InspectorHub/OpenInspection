/**
 * Surface tokens that are meant to be TELLABLE APART must actually differ, in
 * every theme.
 *
 * `--ih-bg-muted` and `--ih-bg-card` were both `#1e293b` in dark mode (IA-124).
 * Nothing failed, nothing warned, and every component that used muted on a card
 * was correct — the token layer had quietly collapsed underneath them. The
 * visible result was 150 `hover:bg-ih-bg-muted` states that did nothing, the
 * `neutral` Pill rendering as bare text beside a real chip, and the "NI" rating
 * pill losing its background in the report editor.
 *
 * It survived that long because muted on the APP background still looked fine,
 * so the failure was a scatter of "that button feels dead" rather than one
 * obvious break. A colour equality check costs nothing and would have caught it
 * the day it was introduced.
 *
 * This parses the stylesheet rather than a rendered page on purpose: the bug was
 * in the declarations, and a jsdom render would not resolve custom properties
 * across theme blocks anyway.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(__dirname, '../../../app/styles/tailwind.css'), 'utf8');

/**
 * The theme blocks, by the selector that opens each one. Every theme must define
 * all three background tiers, and this list is asserted to be complete so a
 * NEW theme cannot be added without being covered.
 */
const THEMES: Array<{ name: string; marker: string }> = [
    { name: 'light', marker: ':root' },
    { name: 'dark', marker: 'data-color-scheme="dark"' },
    { name: 'field', marker: 'data-color-scheme="field"' },
];

/**
 * Every declaration block whose SELECTOR LIST mentions `marker`, in document
 * order.
 *
 * Matching on the selector list rather than on an exact selector string is the
 * whole point: dark is declared as a GROUP —
 * `html[data-color-scheme="dark"], html[data-color-scheme="field"], .dark { … }`
 * — so looking for `html[data-color-scheme="dark"] {` finds nothing. The first
 * version of this file did exactly that, silently fell back to `:root`, and
 * "passed" its dark assertions against the LIGHT palette. A test that cannot see
 * the values it claims to check is worse than no test.
 */
function blocksFor(marker: string): string[] {
    const out: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(CSS)) !== null) {
        if (m[1].includes(marker)) out.push(m[2]);
    }
    return out;
}

/**
 * A token's effective value in one theme, following the real cascade: `field`
 * inherits from the dark group it is part of, and both inherit the `:root`
 * baseline, so an undeclared token falls through to the tier above. Later
 * blocks win within a tier.
 */
function resolved(themeIndex: number, token: string): string {
    for (let i = themeIndex; i >= 0; i--) {
        const blocks = blocksFor(THEMES[i].marker);
        for (let b = blocks.length - 1; b >= 0; b--) {
            const hit = blocks[b].match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
            if (hit) return hit[1].trim();
        }
    }
    throw new Error(`${token} is not defined in any theme at or above ${THEMES[themeIndex].name}`);
}

describe('design tokens — surfaces that must stay distinguishable', () => {
    it('covers every theme the stylesheet declares', () => {
        // Guards the list above: a fourth theme must not silently escape these
        // assertions by simply not being listed.
        const declared = new Set(
            [...CSS.matchAll(/data-color-scheme="([a-z]+)"/g)]
                .map(m => m[1])
                // The sidebar/theme-toggle rules reference the attribute too;
                // only palette-defining values matter here.
                .filter(v => v !== 'auto'),
        );
        expect(declared).toEqual(new Set(THEMES.slice(1).map(t => t.name)));
    });

    it('actually reads each theme (guards against the :root fallback that faked this file once)', () => {
        // If a marker stops matching, `resolved` silently returns the light
        // value and every assertion below becomes vacuous. Pin the one fact
        // that proves each theme block was really found.
        expect(resolved(0, '--ih-bg-app')).toBe('#f8fafc');
        expect(resolved(1, '--ih-bg-app')).toBe('#0f172a');
        expect(resolved(2, '--ih-bg-app')).toBe('#020617');
    });

    it.each(THEMES.map((t, i) => [t.name, i] as const))(
        '%s: --ih-bg-muted is not the same colour as --ih-bg-card',
        (_name, i) => {
            expect(resolved(i, '--ih-bg-muted')).not.toBe(resolved(i, '--ih-bg-card'));
        },
    );

    it.each(THEMES.map((t, i) => [t.name, i] as const))(
        '%s: --ih-bg-muted is not the same colour as --ih-bg-app',
        (_name, i) => {
            // Muted is used on BOTH surfaces, so it has to be distinct from both.
            expect(resolved(i, '--ih-bg-muted')).not.toBe(resolved(i, '--ih-bg-app'));
        },
    );

    it.each(THEMES.map((t, i) => [t.name, i] as const))(
        '%s: --ih-bg-card is not the same colour as --ih-bg-app',
        (_name, i) => {
            expect(resolved(i, '--ih-bg-card')).not.toBe(resolved(i, '--ih-bg-app'));
        },
    );
});

describe('design system — disabled form controls are visibly disabled (IA-127)', () => {
    it('.ih-input has a :disabled rule', () => {
        // Buttons dim themselves via per-component `disabled:opacity-*`; the
        // shared form-control class had nothing, so a locked Select looked
        // exactly like a live one.
        expect(CSS).toMatch(/\.ih-input:disabled\s*\{[^}]*opacity/);
        expect(CSS).toMatch(/\.ih-input:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    });

    it('dims the Select chevron too, since it is a sibling of the control', () => {
        expect(CSS).toMatch(/\.ih-input:disabled\s*\+\s*svg\s*\{[^}]*opacity/);
    });
});
