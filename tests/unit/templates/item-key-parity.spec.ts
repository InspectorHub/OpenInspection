/**
 * Self-test for the item-key-parity gate.
 *
 * A gate that reports "0 problems" is indistinguishable from a gate whose
 * parser never matched anything. So this spec feeds the gate's own comparator
 * a shape it MUST reject, and a shape it MUST accept, before anyone trusts a
 * green run -- and pins the two empty-input cases that would otherwise read as
 * agreement with nothing.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- a gate script is plain .mjs and ships no declarations;
// the comparator under test is the whole reason it is importable at all.
import { compareKeySets } from '../../../scripts/check-item-key-parity.mjs';

describe('compareKeySets', () => {
    it('reports a key the mirror is missing and did not declare skipped', () => {
        const problems = compareKeySets({
            authority: ['id', 'label', 'parentId'],
            mirror: { name: 'ITEM_KEYS', keys: ['id', 'label'], skips: {} },
        });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('parentId');
    });

    it('accepts a missing key that carries an explicit reason', () => {
        // The positive control, and the whole point of the design: SchemaItem
        // reads a handful of the keys on purpose. A gate demanding all seven
        // mirrors be byte-identical would be wrong, not strict.
        const problems = compareKeySets({
            authority: ['id', 'label', 'parentId'],
            mirror: {
                name: 'SchemaItem', keys: ['id', 'label'],
                skips: { parentId: 'the report projection resolves depth separately' },
            },
        });
        expect(problems).toEqual([]);
    });

    it('reports a key the mirror has that the authority does not', () => {
        // Drift in the other direction is still drift.
        const problems = compareKeySets({
            authority: ['id', 'label'],
            mirror: { name: 'ITEM_KEYS', keys: ['id', 'label', 'ghost'], skips: {} },
        });
        expect(problems[0]).toContain('ghost');
    });

    it('treats an EMPTY authority key set as a failure, not as parity', () => {
        // An empty result reads as green. If the parser that extracts the
        // authority keys ever stops matching, every mirror trivially "agrees"
        // with nothing -- which is the failure mode this gate exists to have.
        expect(() => compareKeySets({
            authority: [],
            mirror: { name: 'ITEM_KEYS', keys: ['id'], skips: {} },
        })).toThrow(/authority key set is empty/i);
    });

    it('treats an EMPTY mirror key set as a failure too', () => {
        // Same failure wearing the other hat: a mirror whose parser stopped
        // matching would be missing every key, and reporting fourteen
        // "missing" lines hides the one fact that matters -- the reader broke.
        expect(() => compareKeySets({
            authority: ['id'],
            mirror: { name: 'SchemaItem', keys: [], skips: {} },
        })).toThrow(/key set is empty/i);
    });
});
