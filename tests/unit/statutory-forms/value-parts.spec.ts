/**
 * A form that prints its own separators wants the parts, not the date.
 *
 * The refusals below all have the same shape and the same reason: a blank on an
 * authority's form reads as an inspector who did not answer, never as software
 * that failed to parse. Each one therefore sits beside a POSITIVE CONTROL,
 * because a parser that refused everything would satisfy every negative
 * assertion here perfectly.
 */
import { describe, it, expect } from 'vitest';
import { partOfValue, digitsInPart } from '../../../server/lib/statutory/value-parts';

describe('partOfValue', () => {
    it('takes each part of a calendar day', () => {
        expect(partOfValue('2026-03-15', 'date_month', 'permit_date')).toBe('03');
        expect(partOfValue('2026-03-15', 'date_day', 'permit_date')).toBe('15');
        expect(partOfValue('2026-03-15', 'date_year', 'permit_date')).toBe('2026');
    });

    it('keeps the zero padding the form printed two blanks for', () => {
        // The box is two characters wide because the form cut it that way. A
        // bare "3" under a two-cell blank is a digit somebody has to guess at.
        expect(partOfValue('2026-03-01', 'date_month', 'permit_date')).toBe('03');
        expect(partOfValue('2026-03-01', 'date_day', 'permit_date')).toBe('01');
    });

    it('refuses a date that is not zero-padded', () => {
        // Accepting `2026-3-15` means accepting whatever else a lenient parser
        // accepts -- the reason `utcMidnightOf` already refuses the same shape.
        expect(() => partOfValue('2026-3-15', 'date_month', 'permit_date'))
            .toThrow(/2026-3-15.*YYYY-MM-DD/s);
    });

    it('POSITIVE CONTROL — the padded form of the same day is taken', () => {
        expect(partOfValue('2026-03-15', 'date_month', 'permit_date')).toBe('03');
    });

    it('refuses a day that does not exist', () => {
        // A rolled date crosses a cutover and prints the wrong official
        // document. The round-trip check lives in `utcMidnightOf`; this proves
        // it is actually reached rather than reimplemented loosely here.
        expect(() => partOfValue('2026-02-30', 'date_day', 'permit_date'))
            .toThrow(/2026-02-30/);
    });

    it('POSITIVE CONTROL — the last day that does exist is taken', () => {
        expect(partOfValue('2026-02-28', 'date_day', 'permit_date')).toBe('28');
    });

    it('refuses a slashed date, and says to fix the binding rather than the value', () => {
        // A slashed string reaching a part is evidence the binding points at a
        // free-text item. Parsing it would make ONE document right and hide the
        // binding; and nothing can decide whether "04/03" is April 3rd or the
        // 4th of March, because our own text box prints no hint at all.
        expect(() => partOfValue('03/15/2026', 'date_month', 'permit_date'))
            .toThrow(/03\/15\/2026.*date item/s);
    });

    it('POSITIVE CONTROL — the same day in ISO is taken', () => {
        expect(partOfValue('2026-03-15', 'date_month', 'permit_date')).toBe('03');
    });

    it('names the field, because that is what the person fixing it searches for', () => {
        expect(() => partOfValue('soon', 'date_year', 'roof_covering_metal_permit_application_date'))
            .toThrow(/roof_covering_metal_permit_application_date/);
    });
});

describe('digitsInPart', () => {
    it('states how wide each part is drawn, so a map can be checked without data', () => {
        // Helvetica digits are tabular (every one advances 556/1000), so this
        // count turns into an EXACT width rather than an estimate -- which is
        // what lets `validateAgainstPdf` refuse a blank that is too small
        // before any inspection exists.
        expect(digitsInPart('date_month')).toBe(2);
        expect(digitsInPart('date_day')).toBe(2);
        expect(digitsInPart('date_year')).toBe(4);
    });
});
