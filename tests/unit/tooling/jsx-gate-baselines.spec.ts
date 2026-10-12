import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { missedControls } from '../../../scripts/lib/jsx-gate-runner.mjs';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { detectBusyControls } from '../../../scripts/lib/busy-controls-detect.mjs';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { detectHiddenFocusable } from '../../../scripts/lib/hidden-focusable-detect.mjs';

type Detect = (src: string) => { violations: Array<{ rule: string }> };
const missed = missedControls as (d: Detect, c: Array<{ rule: string; src: string }>) => string[];

/** The planted controls the two gate entry points ship with; a rule that misses its own is a blind rule. */
const BUSY_CONTROLS = [
    { rule: 'submit-unprotected', src: '<button type="submit">Save</button>' },
    { rule: 'native-disable-busy', src: '<Button disabled={isSaving}>Go</Button>' },
];
const HIDDEN_CONTROLS = [
    { rule: 'hover-only-reveal', src: '<div className="opacity-0 group-hover:opacity-100">x</div>' },
    { rule: 'hover-only-touch', src: '<button className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">x</button>' },
    { rule: 'parked-not-inert', src: '<div className="translate-y-full">x</div>' },
];

describe('planted controls: one per rule', () => {
    it('every shipped control fires its own rule', () => {
        expect(missed(detectBusyControls as Detect, BUSY_CONTROLS)).toEqual([]);
        expect(missed(detectHiddenFocusable as Detect, HIDDEN_CONTROLS)).toEqual([]);
    });
    it('names a rule whose control no longer fires, even when another rule still reports violations', () => {
        // Only the reveal rule is alive; a bare "at least N violations" count would still be met.
        const oneRuleAlive: Detect = (src) => ({
            violations: /group-hover/.test(src) ? [{ rule: 'hover-only-reveal' }, { rule: 'hover-only-reveal' }] : [],
        });
        expect(missed(oneRuleAlive, HIDDEN_CONTROLS)).toEqual(['hover-only-touch', 'parked-not-inert']);
    });
    it('a control that fires a DIFFERENT rule does not count', () => {
        const wrongRule: Detect = () => ({ violations: [{ rule: 'something-else' }] });
        expect(missed(wrongRule, BUSY_CONTROLS)).toEqual(['submit-unprotected', 'native-disable-busy']);
    });
});

describe('ratchet baselines stay empty', () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../scripts/${name}`, import.meta.url), 'utf8')) as Record<string, number>;
    it.each(['busy-controls-baseline.json', 'hidden-focusable-baseline.json'])('%s is exactly {}', (name) => {
        expect(Object.keys(read(name))).toEqual([]);
    });
    it('CONTROL - the reader sees a key when there is one', () => {
        expect(Object.keys(JSON.parse('{"app/x.tsx":1}'))).toEqual(['app/x.tsx']);
    });
});
