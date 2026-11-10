import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANNED_COMMENTS } from '../../../server/services/starter-content/fixtures/canned-comments';
import { RECOMMENDATION_SEEDS } from '../../../server/data/recommendation-seeds';
import { RATING_SYSTEM_SEEDS } from '../../../server/data/rating-system-seeds';
import { INSPECTION_TEMPLATES } from '../../../server/services/starter-content.service';

/**
 * The README says "250+ canned comments, 80 repair items, 4 rating systems and
 * 7 inspection templates". Read the numbers out of the README and compare them
 * with the fixtures a new workspace is seeded from, so the sentence cannot drift.
 */
const readme = readFileSync(resolve(__dirname, '../../../README.md'), 'utf8');
const claim = /(\d+)\+ canned comments, (\d+) repair items, (\d+) rating systems and (\d+) inspection templates/.exec(readme);

describe('README starter-content claim', () => {
    it('the sentence is still in the README', () => {
        expect(claim).not.toBeNull();
    });

    it('is backed by the seeded fixtures', () => {
        const [, comments, repairs, ratings, templates] = (claim ?? []).map(Number);
        expect(CANNED_COMMENTS.length).toBeGreaterThanOrEqual(comments ?? Infinity);
        expect(RECOMMENDATION_SEEDS.length).toBeGreaterThanOrEqual(repairs ?? Infinity);
        expect(RATING_SYSTEM_SEEDS.length).toBeGreaterThanOrEqual(ratings ?? Infinity);
        expect(INSPECTION_TEMPLATES.length).toBeGreaterThanOrEqual(templates ?? Infinity);
    });
});
