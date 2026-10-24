/**
 * The limit on how many ids one visibility check may carry: its default, the
 * environment override, and that a bad value can never switch the limit off.
 * The route itself is exercised against a real D1 in tests/workers/native/visibility.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_VISIBLE_IDS_LIMIT, VISIBLE_IDS_LIMIT_CEILING, VISIBLE_IDS_PER_QUERY, readVisibleIdsLimit,
} from '../../../server/lib/native/visibility-limits';

describe('visible-ids limit', () => {
    it('defaults to 300 when the variable is unset, blank or not a number', () => {
        expect(DEFAULT_VISIBLE_IDS_LIMIT).toBe(300);
        for (const raw of [undefined, '', '   ', 'abc', '1.5', '-4', '0x10']) {
            expect(readVisibleIdsLimit({ NATIVE_VISIBLE_MAX_IDS: raw }), String(raw)).toBe(300);
        }
    });

    it('takes an operator override and clamps it into the allowed range', () => {
        expect(readVisibleIdsLimit({ NATIVE_VISIBLE_MAX_IDS: '120' })).toBe(120);
        expect(readVisibleIdsLimit({ NATIVE_VISIBLE_MAX_IDS: '0' })).toBe(1);
        expect(readVisibleIdsLimit({ NATIVE_VISIBLE_MAX_IDS: '999999' })).toBe(VISIBLE_IDS_LIMIT_CEILING);
    });

    it('keeps the worst-case statement within its stated margin: ids + company id + the four assignment parameters', () => {
        const worstCase = VISIBLE_IDS_PER_QUERY + 1 + 4;
        // 90 is the budget this module promises; D1's own limit is 100, so the promise leaves headroom.
        expect(worstCase).toBeLessThanOrEqual(90);
        expect(worstCase).toBe(85);
        // A chunk smaller than the limit would multiply the statement count for no gain in safety.
        expect(VISIBLE_IDS_PER_QUERY).toBeGreaterThanOrEqual(50);
    });
});
