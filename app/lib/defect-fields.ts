/**
 * Per-defect structured field vocabularies, for app-side use.
 *
 * The vocabularies themselves are NOT defined here. They are re-exported from
 * `server/types/defect-fields.ts`, because that list is what decides whether a
 * value survives a write: `server/services/inspection/shared.ts` sanitizes
 * every incoming defect state against it and stores NULL for anything it does
 * not recognise, and `contractor_types.trade_slug` is seeded from the same
 * list. An option this module offered but the server did not know would throw
 * away the inspector's choice on save, silently and with no error surface.
 * Importing removes the possibility rather than adding a check for it.
 *
 * What is genuinely app-only lives below: the `*_OPTIONS` arrays, shaped for
 * `<select>` / dropdown UI, derived from the same imported lists.
 */

import {
    DEFECT_TRADES,
    DEFECT_DEADLINES,
    DEFECT_TIMEFRAMES,
    DEFECT_TRADE_LABELS,
    DEFECT_DEADLINE_LABELS,
    DEFECT_TIMEFRAME_LABELS,
} from '../../server/types/defect-fields';

export type {
    DefectTrade,
    DefectDeadline,
    DefectTimeframe,
} from '../../server/types/defect-fields';

export { DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS };

// React-friendly option arrays for <select> / dropdown UI.
// These do not exist server-side — frontend-only convenience.

export const DEFECT_TRADE_OPTIONS = DEFECT_TRADES.map(id => ({
    value: id,
    label: DEFECT_TRADE_LABELS[id],
}));
export const DEFECT_DEADLINE_OPTIONS = DEFECT_DEADLINES.map(id => ({
    value: id,
    label: DEFECT_DEADLINE_LABELS[id],
}));
export const DEFECT_TIMEFRAME_OPTIONS = DEFECT_TIMEFRAMES.map(id => ({
    value: id,
    label: DEFECT_TIMEFRAME_LABELS[id],
}));
