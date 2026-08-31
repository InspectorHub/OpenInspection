import { describe, it, expect } from 'vitest';
import { calendarDayForForm, partOfValue } from '../../../server/lib/statutory/value-parts';

/**
 * How a stored calendar day is printed on an authority's form.
 *
 * -- WHAT WENT WRONG ---------------------------------------------------------
 * `inspections.date` is `YYYY-MM-DD` and reached the page unchanged, so a
 * produced TREC REI 7-6 carried "2026-08-20" in its Date of Inspection box.
 * Nothing failed; the document was simply wrong in a way a Texas inspector
 * notices and this software did not.
 */
describe('calendarDayForForm', () => {
    it('prints the day the way these forms print it', () => {
        expect(calendarDayForForm('2026-08-20', 'inspection_date')).toBe('08/20/2026');
    });

    it('keeps the leading zeroes, because a form blank is a fixed shape', () => {
        // "8/5/2026" is not what a preprinted MM/DD/YYYY blank expects, and the
        // 1802 prints that hint next to the line.
        expect(calendarDayForForm('2026-08-05', 'd')).toBe('08/05/2026');
        expect(calendarDayForForm('2026-01-01', 'd')).toBe('01/01/2026');
    });

    it('refuses a value that is not a calendar day, naming the field', () => {
        // The name is what the person fixing the template searches for.
        expect(() => calendarDayForForm('20/08/2026', 'inspection_date'))
            .toThrow(/inspection_date/);
        expect(() => calendarDayForForm('', 'inspection_date')).toThrow(/not a YYYY-MM-DD/);
    });

    it('refuses a day that does not exist rather than rolling it', () => {
        // A rolled date (2026-02-30 -> March 2nd) can cross a revision cutover
        // and print the wrong official document.
        expect(() => calendarDayForForm('2026-02-30', 'inspection_date'))
            .toThrow(/not a day that exists/);
    });

    it('is NOT what a parted field takes, and that refusal is legible', () => {
        // The hazard the call site documents: a map drawing this fact as three
        // blanks would receive an already-formatted string. It must fail by
        // name, not print a year into the month blank.
        const formatted = calendarDayForForm('2026-08-20', 'inspection_date');
        expect(() => partOfValue(formatted, 'date_month', 'inspection_date'))
            .toThrow(/inspection_date/);
    });

    it('agrees with partOfValue about the same day', () => {
        // Two parsers is how one of them ends up lenient. These two must always
        // read one stored day the same way.
        const iso = '2026-08-20';
        expect(calendarDayForForm(iso, 'd')).toBe([
            partOfValue(iso, 'date_month', 'd'),
            partOfValue(iso, 'date_day', 'd'),
            partOfValue(iso, 'date_year', 'd'),
        ].join('/'));
    });
});
