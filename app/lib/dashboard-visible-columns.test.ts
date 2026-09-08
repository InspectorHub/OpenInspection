/**
 * Which dashboard columns survive a narrow viewport.
 *
 * `DashboardColumn.mobileVisible` has said since it was written that a column
 * marked `false` is "dropped on small viewports even when toggled on". Five
 * columns carry it and no layout consulted it, so the responsive behaviour it
 * describes was whatever the CSS happened to do.
 *
 * ⚠️ THE FLAG IS NOT COPIED HERE. The registry the UI renders from
 * (`app/lib/dashboard-schema.ts`) and the one the server validates against
 * (`server/lib/dashboard-columns.ts`) are already two lists of the same twelve
 * ids; adding `mobileVisible` to the second of them would have made a third
 * copy of one fact, and the pair would eventually disagree with nobody
 * noticing. The server registry exports the set instead, and this module reads
 * it — which is also what makes the field genuinely read rather than merely
 * documented.
 */
import { describe, it, expect } from 'vitest';

import { visibleColumnIds } from '~/lib/dashboard-visible-columns';
import { MOBILE_HIDDEN_COLUMNS } from '../../server/lib/dashboard-columns';

describe('visibleColumnIds', () => {
    it('drops a mobile-hidden column on a narrow viewport even when it is on', () => {
        const hidden = [...MOBILE_HIDDEN_COLUMNS][0]!;
        expect(visibleColumnIds(['propertyAddress', hidden], true)).toEqual(['propertyAddress']);
    });

    /**
     * POSITIVE CONTROL. A function that always dropped it would pass the case
     * above and would take the column away on a desktop that has room for it.
     */
    it('keeps it on a wide viewport', () => {
        const hidden = [...MOBILE_HIDDEN_COLUMNS][0]!;
        expect(visibleColumnIds(['propertyAddress', hidden], false))
            .toEqual(['propertyAddress', hidden]);
    });

    /**
     * SECOND CONTROL. A function that returned the whole registry would pass
     * both of the above whenever the caller happened to enable everything. A
     * column the user turned off must not come back at either width.
     */
    it('never resurrects a column the user turned off', () => {
        expect(visibleColumnIds(['propertyAddress'], false)).toEqual(['propertyAddress']);
        expect(visibleColumnIds(['propertyAddress'], true)).toEqual(['propertyAddress']);
    });

    /**
     * The field's own doc: "Default `true` (visible on mobile)." An unmarked
     * column stays.
     */
    it('treats an unmarked column as visible on mobile', () => {
        expect(MOBILE_HIDDEN_COLUMNS.has('propertyAddress')).toBe(false);
        expect(visibleColumnIds(['propertyAddress'], true)).toEqual(['propertyAddress']);
    });

    it('preserves the order it was given', () => {
        expect(visibleColumnIds(['date', 'propertyAddress', 'clientName'], true))
            .toEqual(['date', 'propertyAddress', 'clientName']);
    });

    /**
     * POSITIVE CONTROL FOR THE INSTRUMENT. Every assertion above is vacuous if
     * the imported set is empty — and an empty set is exactly what a rename or
     * a bad filter would produce, silently.
     */
    it('is measuring a non-empty set of mobile-hidden columns', () => {
        expect(MOBILE_HIDDEN_COLUMNS.size).toBeGreaterThan(0);
    });
});
