import { describe, it, expect } from 'vitest';
import { filterImportableBlocks } from '../../../server/lib/calendar/google-import';
import type { BusyBlock } from '../../../server/lib/calendar/provider';

const CONNECTED_AT = Date.UTC(2026, 5, 1, 12, 0);
const AFTER = Date.UTC(2026, 5, 2, 9, 0);
const BEFORE = Date.UTC(2026, 4, 20, 9, 0);

function block(over: Partial<BusyBlock> = {}): BusyBlock {
    return {
        start: '2026-06-10T14:00:00Z',
        end: '2026-06-10T16:00:00Z',
        externalId: 'ev-1',
        transparency: 'opaque',
        createdMs: AFTER,
        ...over,
    };
}

const run = (blocks: BusyBlock[], ownIds: string[] = []) =>
    filterImportableBlocks(blocks, {
        ownExternalIds: new Set(ownIds),
        connectedAtMs: CONNECTED_AT,
    });

describe('filterImportableBlocks — Spectora one-off import semantics', () => {
    it('keeps an ordinary one-off event created after connect', () => {
        const out = run([block()]);
        expect(out.keep).toHaveLength(1);
        expect(out.skipped).toEqual({ oi_originated: 0, recurring_instance: 0, before_connect: 0 });
    });

    /**
     * Rule 2. Without it the calendar round-trips: OI pushes an inspection to
     * Google, reads it back as busy, and the inspector is then unavailable for
     * the very job they are booked on.
     */
    it('skips events OI itself pushed, so a booking cannot block its own inspector', () => {
        const out = run([block({ externalId: 'ours' }), block({ externalId: 'theirs' })], ['ours']);
        expect(out.keep.map((b) => b.externalId)).toEqual(['theirs']);
        expect(out.skipped.oi_originated).toBe(1);
    });

    /**
     * Rule 3. singleEvents=true expands a series into instances, so a weekly
     * standup would otherwise arrive as dozens of separate busy blocks.
     */
    it('skips instances of a recurring series', () => {
        const out = run([
            block({ externalId: 'once' }),
            block({ externalId: 'weekly-1', recurringEventId: 'series-a' }),
            block({ externalId: 'weekly-2', recurringEventId: 'series-a' }),
        ]);
        expect(out.keep.map((b) => b.externalId)).toEqual(['once']);
        expect(out.skipped.recurring_instance).toBe(2);
    });

    /** Rule 6 — connecting a calendar must not retroactively block accepted work. */
    it('skips events created before the connection', () => {
        const out = run([block({ externalId: 'old', createdMs: BEFORE })]);
        expect(out.keep).toHaveLength(0);
        expect(out.skipped.before_connect).toBe(1);
    });

    it('keeps an old event that was edited after connect', () => {
        const out = run([block({ externalId: 'moved', createdMs: BEFORE, updatedMs: AFTER })]);
        expect(out.keep).toHaveLength(1);
        expect(out.skipped.before_connect).toBe(0);
    });

    /**
     * Fail toward blocking time. A spurious busy block is visible and
     * correctable; a missed one silently double-books the inspector.
     */
    it('keeps an event the provider gave no timestamps for', () => {
        const out = run([block({ externalId: 'undated', createdMs: undefined })]);
        expect(out.keep).toHaveLength(1);
    });

    /**
     * freeBusy ranges are anonymous — no id, no recurrence, no timestamps. None
     * of the rules can be evaluated, so the coarse fallback must stay coarse
     * rather than silently filtering itself down to nothing.
     */
    it('keeps anonymous freeBusy ranges untouched', () => {
        const out = run([{ start: '2026-06-10T14:00:00Z', end: '2026-06-10T16:00:00Z' }]);
        expect(out.keep).toHaveLength(1);
        expect(out.skipped).toEqual({ oi_originated: 0, recurring_instance: 0, before_connect: 0 });
    });

    it('carries transparency through so transparent events stay non-blocking', () => {
        const out = run([block({ transparency: 'transparent' })]);
        expect(out.keep[0]!.transparency).toBe('transparent');
    });

    it('applies OI-origination before recurrence so the count is not double-attributed', () => {
        const out = run([block({ externalId: 'ours', recurringEventId: 'series' })], ['ours']);
        expect(out.skipped.oi_originated).toBe(1);
        expect(out.skipped.recurring_instance).toBe(0);
    });
});
