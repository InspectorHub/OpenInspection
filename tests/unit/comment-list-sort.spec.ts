import { describe, it, expect } from 'vitest';

interface FilterCtx {
    sort:         'relevance' | 'recent' | 'created' | 'frequent' | 'alpha';
    filterMode:   'auto' | 'all';
    itemLabel?:   string;
    section?:     string;
    ratingBucket?: 'satisfactory' | 'monitor' | 'defect';
}

interface Decision {
    matchItemLabel:   boolean;
    matchSection:     boolean;
    matchRating:      boolean;
    orderBy:          string;
}

export function decideQuery(ctx: FilterCtx): Decision {
    const auto = ctx.filterMode === 'auto';
    return {
        matchItemLabel: auto && !!ctx.itemLabel,
        matchSection:   auto && !!ctx.section,
        matchRating:    auto && !!ctx.ratingBucket,
        orderBy: ({
            relevance: 'rating_bucket, created_at DESC',
            recent:    'last_used_at DESC NULLS LAST',
            created:   'created_at DESC',
            frequent:  'use_count DESC, last_used_at DESC',
            alpha:     'text ASC',
        } as Record<typeof ctx.sort, string>)[ctx.sort],
    };
}

describe('decideQuery', () => {
    it('filterMode=all ignores context filters', () => {
        const d = decideQuery({ sort: 'recent', filterMode: 'all', itemLabel: 'Roof Covering', section: 'Roof', ratingBucket: 'defect' });
        expect(d.matchItemLabel).toBe(false);
        expect(d.matchSection).toBe(false);
        expect(d.matchRating).toBe(false);
    });

    it('filterMode=auto applies all present context filters', () => {
        const d = decideQuery({ sort: 'recent', filterMode: 'auto', itemLabel: 'Roof Covering', section: 'Roof', ratingBucket: 'defect' });
        expect(d.matchItemLabel).toBe(true);
        expect(d.matchSection).toBe(true);
        expect(d.matchRating).toBe(true);
    });

    it('filterMode=auto skips filters whose context value is missing', () => {
        const d = decideQuery({ sort: 'recent', filterMode: 'auto', itemLabel: 'Roof Covering' });
        expect(d.matchItemLabel).toBe(true);
        expect(d.matchSection).toBe(false);
        expect(d.matchRating).toBe(false);
    });

    it('each sort option maps to a distinct ORDER BY', () => {
        const sorts = ['relevance', 'recent', 'created', 'frequent', 'alpha'] as const;
        const seen = new Set(sorts.map(s => decideQuery({ sort: s, filterMode: 'all' }).orderBy));
        expect(seen.size).toBe(5);
    });
});
