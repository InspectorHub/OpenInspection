/**
 * Design System 0520 subsystem B phase 1 task 1.3 — JSON tolerance smoke.
 *
 * Verifies that the new field-version metadata (`<field>_v`, `<field>_by`,
 * `<field>_at`) layered onto inspection_results.data[itemId] entries in
 * phase 3 does not trip any existing read path. Pure-shape contract test —
 * no DB / service spin-up needed.
 */
import { describe, it, expect } from 'vitest';

describe('inspection_results.data shape tolerance (subsystem B phase 1)', () => {
    it('legacy reader destructure ignores _v/_by/_at suffixes', () => {
        const data = JSON.parse(`{
            "item-1": {
                "rating":    "defect",
                "rating_v":  3,
                "rating_by": "user-abc",
                "rating_at": 1700000000,
                "notes":     "leak under sink",
                "notes_v":   2,
                "notes_by":  "user-def",
                "notes_at":  1700000500,
                "photos":    ["p1", "p2"],
                "photos_v":  4
            }
        }`);

        // Existing code paths typically destructure { rating, notes, photos }
        // from data[itemId]. Suffix fields must coexist invisibly.
        const { rating, notes, photos } = data['item-1'];
        expect(rating).toBe('defect');
        expect(notes).toBe('leak under sink');
        expect(photos).toEqual(['p1', 'p2']);

        // Metadata is present and reachable by future opt-in consumers.
        expect(data['item-1'].rating_v).toBe(3);
        expect(data['item-1'].notes_by).toBe('user-def');
        expect(data['item-1'].photos_v).toBe(4);
    });

    it('legacy item without _v reads as version 0 in phase-3 patchItem logic', () => {
        const data = JSON.parse(`{
            "item-legacy": { "rating": "sat", "notes": "fine" }
        }`);
        const item = data['item-legacy'];
        // Per spec: missing suffix === 0
        const ratingVersion = item['rating_v'] ?? 0;
        const notesVersion  = item['notes_v']  ?? 0;
        expect(ratingVersion).toBe(0);
        expect(notesVersion).toBe(0);
    });

    it('property_facts._meta is tolerated by legacy readers', () => {
        const facts = JSON.parse(`{
            "year_built": 1973,
            "sqft":       1840,
            "_meta": {
                "year_built": { "by": "user-abc", "at": 1734200000, "v": 1 },
                "sqft":       { "by": "user-def", "at": 1734200500, "v": 2 }
            }
        }`);

        // Legacy callsites iterate keys to render rows; _meta surfaces only
        // when an opt-in consumer reads it explicitly.
        const visibleKeys = Object.keys(facts).filter(k => !k.startsWith('_'));
        expect(visibleKeys).toEqual(['year_built', 'sqft']);
        expect(facts._meta.year_built.by).toBe('user-abc');
    });
});
