import { describe, it, expect } from 'vitest';
import {
    publicTimezoneOptions,
    CURATED_ZONE_IDS,
    CURATED_DROPPED,
} from '~/lib/timezone-options-public';
import { TIMEZONE_OPTIONS, timeZoneOffsetMinutes } from '~/lib/timezones';

/**
 * The curated public zone list (#99).
 *
 * A public report viewer is confirming which clock a timestamp is on, so the
 * list trades completeness for recognisable names — "Central Time", not
 * "America/Indiana/Tell_City". Settings keeps the full list, because a tenant
 * configuring their company's zone needs their actual zone.
 *
 * The trade only holds if an uncurated viewer is handled, which is what most of
 * this file is about.
 */
describe('publicTimezoneOptions', () => {
    it('every offered id is a zone this runtime lists', () => {
        // A typo here does not throw: `timeZoneOffsetMinutes` catches and returns
        // 0, so a misspelled zone would sort to UTC and quietly render the wrong
        // offset for whoever picked it. And an id the runtime does not LIST (as
        // opposed to cannot format) is one `viewer-timezone` would refuse to
        // adopt, so the viewer would silently get a duplicate entry for the zone
        // they are already in.
        const unknown = CURATED_ZONE_IDS.filter((id) => !TIMEZONE_OPTIONS.includes(id));
        expect(unknown, `not listed by this runtime: ${unknown.join(', ')}`).toEqual([]);
    });

    it('this runtime can represent every authored zone', () => {
        // Zones get renamed, and which spelling is canonical depends on the age
        // of the runtime's ICU — this repo's Node still says `Asia/Calcutta`
        // where browsers say `Asia/Kolkata`. Unresolvable entries are dropped so
        // the picker never offers a value the rest of the code would reject; this
        // asserts the drop count is ZERO so that renaming shows up here as a
        // failing test instead of as zones quietly vanishing from the list.
        expect(
            CURATED_DROPPED,
            'authored zones this runtime knows under neither spelling — add them to RENAMED',
        ).toBe(0);
    });

    it('is a curated subset, not the whole list', () => {
        // If this ever approached the full set the split would be pointless, and
        // the cost it was built to avoid would be back with extra indirection.
        expect(CURATED_ZONE_IDS.length).toBeLessThan(TIMEZONE_OPTIONS.length / 3);
        expect(CURATED_ZONE_IDS.length).toBeGreaterThan(40);
    });

    it('labels read `(UTC±HH:MM) Recognisable Name`', () => {
        for (const o of publicTimezoneOptions('UTC')) {
            expect(o.label, o.value).toMatch(/^\(UTC[+-]\d{2}:\d{2}\) .+/);
        }
    });

    it('offers no zone twice', () => {
        const values = publicTimezoneOptions('UTC').map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it('is sorted west→east', () => {
        const offsets = publicTimezoneOptions('UTC').map((o) => timeZoneOffsetMinutes(o.value));
        for (let i = 1; i < offsets.length; i++) {
            expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
        }
    });

    describe('a viewer whose zone is not curated', () => {
        // `America/Indiana/Tell_City` is a real IANA zone the browser can report
        // and this list deliberately does not carry.
        const UNCURATED = 'America/Indiana/Tell_City';

        it('the fixture is genuinely uncurated', () => {
            // Otherwise the three assertions below would pass by testing the
            // curated path and prove nothing about the branch they name.
            expect(CURATED_ZONE_IDS).not.toContain(UNCURATED);
            expect(TIMEZONE_OPTIONS).toContain(UNCURATED);
        });

        it('gets their own zone in the list', () => {
            // Without this a <select> whose value matches no <option> displays the
            // FIRST option instead — telling them their times are on a clock they
            // never chose, with nothing anywhere to notice.
            const values = publicTimezoneOptions(UNCURATED).map((o) => o.value);
            expect(values).toContain(UNCURATED);
            expect(values.length).toBe(CURATED_ZONE_IDS.length + 1);
        });

        it('keeps the list sorted once it is added', () => {
            const offsets = publicTimezoneOptions(UNCURATED).map((o) =>
                timeZoneOffsetMinutes(o.value),
            );
            for (let i = 1; i < offsets.length; i++) {
                expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
            }
        });

        it('names it by its canonical id, the only honest name available', () => {
            const added = publicTimezoneOptions(UNCURATED).find((o) => o.value === UNCURATED);
            expect(added?.label).toContain('America/Indiana/Tell City');
        });
    });

    it('adds nothing for a curated zone, or for no zone at all', () => {
        for (const tz of ['America/Chicago', null, undefined, '']) {
            expect(publicTimezoneOptions(tz).length, String(tz)).toBe(CURATED_ZONE_IDS.length);
        }
    });
});
