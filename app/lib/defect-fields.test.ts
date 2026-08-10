import { describe, it, expect } from 'vitest';
import {
    DEFECT_TRADES,
    DEFECT_DEADLINES,
    DEFECT_TIMEFRAMES,
    DEFECT_TRADE_LABELS,
    DEFECT_DEADLINE_LABELS,
    DEFECT_TIMEFRAME_LABELS,
} from '../../server/types/defect-fields';
import {
    DEFECT_TRADE_OPTIONS,
    DEFECT_DEADLINE_OPTIONS,
    DEFECT_TIMEFRAME_OPTIONS,
} from './defect-fields';

/**
 * The editor dropdowns must offer exactly what the write path accepts:
 * `server/services/inspection/shared.ts` sanitizes defect states against these
 * lists and stores NULL for anything else, so an extra client-side option is a
 * silently discarded inspector choice. `app/lib/defect-fields.ts` derives the
 * options from the server lists, which is what makes these assertions hold;
 * they fail the moment someone reintroduces a local copy that has drifted.
 */
describe('defect field options track the server vocabularies', () => {
    it('offers exactly the server trade ids, in order', () => {
        expect(DEFECT_TRADE_OPTIONS.map(o => o.value)).toEqual([...DEFECT_TRADES]);
    });

    it('offers exactly the server deadline ids, in order', () => {
        expect(DEFECT_DEADLINE_OPTIONS.map(o => o.value)).toEqual([...DEFECT_DEADLINES]);
    });

    it('offers exactly the server timeframe ids, in order', () => {
        expect(DEFECT_TIMEFRAME_OPTIONS.map(o => o.value)).toEqual([...DEFECT_TIMEFRAMES]);
    });

    it('labels each option with the server label for that id', () => {
        for (const o of DEFECT_TRADE_OPTIONS) expect(o.label).toBe(DEFECT_TRADE_LABELS[o.value]);
        for (const o of DEFECT_DEADLINE_OPTIONS) expect(o.label).toBe(DEFECT_DEADLINE_LABELS[o.value]);
        for (const o of DEFECT_TIMEFRAME_OPTIONS) expect(o.label).toBe(DEFECT_TIMEFRAME_LABELS[o.value]);
    });
});
