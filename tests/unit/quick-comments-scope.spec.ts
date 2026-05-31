/**
 * Sprint 1 Sub-spec A Task 5 — InspectionService.rankCannedCommentsForItem.
 *
 * Verifies item-aware ranking promotes entries whose comment text or
 * category names the active item before generic section-only entries.
 *
 * The DB `comments` table currently has no `itemLabels` column, so the
 * ranker uses fuzzy matching on `text` + `category` against the item
 * label, falling back to section + rating-bucket scoring.
 */
import { describe, it, expect } from 'vitest';
import { rankCannedCommentsForItem, type CannedCommentLike } from '../../server/services/inspection.service';

const sample: CannedCommentLike[] = [
    { id: 'c1', section: 'Roof',  category: 'Roof Covering',         text: 'Roof covering appears serviceable.',                  ratingBucket: 'satisfactory' },
    { id: 'c2', section: 'Roof',  category: 'Roof Flashing',         text: 'Roof flashing at penetrations is properly sealed.',   ratingBucket: 'satisfactory' },
    { id: 'c3', section: 'Roof',  category: 'Gutters & Downspouts',  text: 'Gutters and downspouts are securely attached.',       ratingBucket: 'satisfactory' },
    { id: 'c4', section: 'Roof',  category: null,                    text: 'A musty odor was present in the attic.',              ratingBucket: 'defect' },
    { id: 'c5', section: 'Other', category: 'Gutters',               text: 'Gutter pitch is reversed.',                           ratingBucket: 'defect' },
];

describe('rankCannedCommentsForItem — ITEM-aware ranking (A-2)', () => {
    it('ranks an exact item-label category match first', () => {
        const ranked = rankCannedCommentsForItem(sample, { section: 'Roof', itemLabel: 'Gutters & Downspouts' });
        expect(ranked[0].id).toBe('c3');
    });

    it('promotes entries whose text contains the item label keywords', () => {
        const ranked = rankCannedCommentsForItem(sample, { section: 'Roof', itemLabel: 'Gutters' });
        // c3 (category contains "Gutters") and c5 (category "Gutters") should
        // outrank generic section comments c1 / c4.
        expect(['c3', 'c5']).toContain(ranked[0].id);
    });

    it('falls back to section match when no item match', () => {
        const ranked = rankCannedCommentsForItem(sample, { section: 'Roof', itemLabel: 'Skylights' });
        expect(ranked.length).toBeGreaterThan(0);
        // Top should be a Roof-section row, not the cross-section Gutters c5.
        expect(ranked[0].section).toBe('Roof');
    });

    it('boosts entries whose ratingBucket matches the requested rating', () => {
        const ranked = rankCannedCommentsForItem(sample, { section: 'Roof', itemLabel: 'Gutters & Downspouts', rating: 'defect' });
        // c3 still wins on category exact match, but defect c4/c5 should outrank
        // the satisfactory c1/c2 amongst the rest.
        const indexOf = (id: string) => ranked.findIndex(r => r.id === id);
        expect(indexOf('c4')).toBeLessThan(indexOf('c1'));
    });

    it('returns at most `limit` entries when specified', () => {
        const ranked = rankCannedCommentsForItem(sample, { section: 'Roof', itemLabel: 'Gutters', limit: 2 });
        expect(ranked.length).toBe(2);
    });

    it('handles empty inputs gracefully', () => {
        expect(rankCannedCommentsForItem([], { section: 'Roof', itemLabel: 'Anything' })).toEqual([]);
    });
});
