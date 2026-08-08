// #181 PR-H (Task H2) — pure projection-diff unit tests.
//
// Node environment (vitest.api.config.ts). Imports the util by relative path
// (this config has no `~` alias). Covers: precise scalar change with the OLD
// (from) value preserved, item add/remove, coarse nested flagging + summary,
// no-change findings excluded, and stable ordering.
import { describe, it, expect } from 'vitest';
import { diffProjections } from '../../../app/lib/collab/snapshot-diff';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';

describe('diffProjections — scalar changes', () => {
    it('detects a rating change and preserves the OLD value in `from`', () => {
        const from: ResultsProjection = { '_default:s1:i1': { rating: 'NI' } };
        const to: ResultsProjection = { '_default:s1:i1': { rating: 'RR' } };

        const diffs = diffProjections(from, to);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].findingKey).toBe('_default:s1:i1');
        expect(diffs[0].scalarChanges).toEqual([{ field: 'rating', from: 'NI', to: 'RR' }]);
        expect(diffs[0].nestedChanged).toBe(false);
        expect(diffs[0].itemAdded).toBeUndefined();
        expect(diffs[0].itemRemoved).toBeUndefined();
    });

    it('emits one FieldChange per differing scalar, in the fixed field order', () => {
        // `recommendation` stands where `estimateMin` used to: the diffed
        // fields are exactly those "Recover" is allowed to write back, and a
        // repair price is not one of them.
        const from: ResultsProjection = {
            '_default:s1:i1': { notes: 'old note', recommendation: 'monitor', followupNotes: 'a' },
        };
        const to: ResultsProjection = {
            '_default:s1:i1': { notes: 'new note', recommendation: 'replace', followupNotes: 'b' },
        };

        const diffs = diffProjections(from, to);
        expect(diffs[0].scalarChanges.map((c) => c.field)).toEqual([
            'notes',
            'recommendation',
            'followupNotes',
        ]);
        expect(diffs[0].scalarChanges[0]).toEqual({ field: 'notes', from: 'old note', to: 'new note' });
        expect(diffs[0].scalarChanges[1]).toEqual({ field: 'recommendation', from: 'monitor', to: 'replace' });
    });

    it('never diffs a repair-price field, even when both sides carry one', () => {
        // A legacy pair of snapshots both holding an item-level estimate. The
        // diff must not offer it as a recoverable change — "Recover" writes the
        // old value back through applyItemPatch, which would be the retired
        // capability returning through the version history.
        const from = {
            '_default:s1:i1': { notes: 'a', estimateMin: 100, estimateMax: 500 },
        } as unknown as ResultsProjection;
        const to = {
            '_default:s1:i1': { notes: 'b', estimateMin: 200, estimateMax: 900 },
        } as unknown as ResultsProjection;
        expect(JSON.stringify(from)).toContain('100');

        const diffs = diffProjections(from, to);
        expect(diffs[0].scalarChanges.map((c) => c.field)).toEqual(['notes']);
    });

    it('does NOT report a scalar that is unchanged', () => {
        const from: ResultsProjection = { '_default:s1:i1': { rating: 'NI', notes: 'same' } };
        const to: ResultsProjection = { '_default:s1:i1': { rating: 'RR', notes: 'same' } };

        const diffs = diffProjections(from, to);
        expect(diffs[0].scalarChanges.map((c) => c.field)).toEqual(['rating']);
    });
});

describe('diffProjections — add / remove', () => {
    it('flags an item present only in `to` as added', () => {
        const from: ResultsProjection = {};
        const to: ResultsProjection = { '_default:s1:i1': { rating: 'RR' } };

        const diffs = diffProjections(from, to);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].itemAdded).toBe(true);
        expect(diffs[0].itemRemoved).toBeUndefined();
    });

    it('flags an item present only in `from` as removed', () => {
        const from: ResultsProjection = { '_default:s1:i1': { rating: 'RR' } };
        const to: ResultsProjection = {};

        const diffs = diffProjections(from, to);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].itemRemoved).toBe(true);
        expect(diffs[0].itemAdded).toBeUndefined();
    });
});

describe('diffProjections — coarse nested', () => {
    it('flags a photos change and summarizes counts WITHOUT scalar changes', () => {
        const from: ResultsProjection = {
            '_default:s1:i1': { rating: 'RR', photos: [{ key: 'a' }, { key: 'b' }] },
        };
        const to: ResultsProjection = {
            '_default:s1:i1': { rating: 'RR', photos: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] },
        };

        const diffs = diffProjections(from, to);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].scalarChanges).toHaveLength(0);
        expect(diffs[0].nestedChanged).toBe(true);
        expect(diffs[0].nestedSummary).toContain('photos 2 -> 3');
    });

    it('summarizes tabs (defects) count changes', () => {
        const from: ResultsProjection = {
            '_default:s1:i1': { tabs: { defects: [{ cannedId: 'd1', included: true }] } },
        };
        const to: ResultsProjection = {
            '_default:s1:i1': {
                tabs: {
                    defects: [
                        { cannedId: 'd1', included: true },
                        { cannedId: 'd2', included: true },
                    ],
                },
            },
        };

        const diffs = diffProjections(from, to);
        expect(diffs[0].nestedChanged).toBe(true);
        expect(diffs[0].nestedSummary).toContain('tabs 1 -> 2');
    });

    it('does NOT flag nested when the container is structurally equal (key order ignored)', () => {
        const from: ResultsProjection = {
            '_default:s1:i1': { attributes: { a: 1, b: 2 } },
        };
        const to: ResultsProjection = {
            '_default:s1:i1': { attributes: { b: 2, a: 1 } },
        };

        const diffs = diffProjections(from, to);
        expect(diffs).toHaveLength(0);
    });
});

describe('diffProjections — exclusion and ordering', () => {
    it('excludes findings with no change at all', () => {
        const from: ResultsProjection = {
            '_default:s1:i1': { rating: 'RR', notes: 'same' },
            '_default:s1:i2': { rating: 'NI' },
        };
        const to: ResultsProjection = {
            '_default:s1:i1': { rating: 'RR', notes: 'same' },
            '_default:s1:i2': { rating: 'MM' },
        };

        const diffs = diffProjections(from, to);
        expect(diffs.map((d) => d.findingKey)).toEqual(['_default:s1:i2']);
    });

    it('returns diffs sorted by finding key', () => {
        const from: ResultsProjection = {
            '_default:s1:i3': { rating: 'NI' },
            '_default:s1:i1': { rating: 'NI' },
            '_default:s1:i2': { rating: 'NI' },
        };
        const to: ResultsProjection = {
            '_default:s1:i3': { rating: 'RR' },
            '_default:s1:i1': { rating: 'RR' },
            '_default:s1:i2': { rating: 'RR' },
        };

        const diffs = diffProjections(from, to);
        expect(diffs.map((d) => d.findingKey)).toEqual([
            '_default:s1:i1',
            '_default:s1:i2',
            '_default:s1:i3',
        ]);
    });

    it('returns [] for two identical projections', () => {
        const proj: ResultsProjection = { '_default:s1:i1': { rating: 'RR', notes: 'x' } };
        expect(diffProjections(proj, { '_default:s1:i1': { rating: 'RR', notes: 'x' } })).toEqual([]);
    });
});
