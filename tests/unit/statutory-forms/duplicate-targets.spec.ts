/**
 * Two mappings must not write to the same PLACE on the form.
 *
 * -- What this replaced, and why ---------------------------------------------
 * The rule used to key on the FIELD: a second mapping of `client.name` was
 * refused whatever it pointed at. Measured on Florida's OIR-B1-1802, that is
 * wrong in both directions.
 *
 * It refuses a form that is asking twice. The 1802 prints the inspector's
 * initials and the property address in EVERY ONE of its six page footers, at
 * six different coordinates. Six mappings of one value is what that form is; the
 * old rule made it unmappable, and the only way to satisfy it would have been to
 * invent six field names for one answer.
 *
 * And it misses the failure it was written for. Its own stated reason was "a
 * coordinate that was pasted and never re-measured" -- and a paste that also
 * changed `ourField` sails through, drawing two DIFFERENT values at one
 * coordinate. One of them is painted over the other, on a document somebody
 * files with a government agency, and nothing anywhere says so.
 *
 * So the key is the target: the same `pdfField`, or the same (page, x, y).
 */
import { describe, it, expect } from 'vitest';
import {
    validateFieldMapShape, type FieldMap, type FieldMapping,
} from '../../../server/lib/statutory/field-map';

const MAP = (mappings: readonly FieldMapping[]): FieldMap => ({
    formId: 'xx_example_form',
    version: '1-0',
    sourceHash: 'a'.repeat(64),
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-29T00:00:00.000Z'),
    requiredFields: [],
    mappings,
});

/** One overlay, spelled out so each test can vary exactly one thing. */
const overlay = (
    ourField: string, page: number, x: number, y: number,
): FieldMapping => ({ kind: 'overlay', ourField, page, x, y, size: 9 });

describe('a repeated target', () => {
    it('refuses two DIFFERENT values drawn at one coordinate', () => {
        // The failure the old rule could not see. Both mappings are legal on
        // their own, both name a field the map is allowed to draw, and the
        // second is painted over the first.
        expect(() => validateFieldMapShape(MAP([
            overlay('owner.name', 0, 116.8, 70.72),
            overlay('property.address', 0, 116.8, 70.72),
        ]))).toThrow(/116\.8/);
    });

    it('POSITIVE CONTROL — the same two values at two coordinates validate', () => {
        expect(() => validateFieldMapShape(MAP([
            overlay('owner.name', 0, 116.8, 70.72),
            overlay('property.address', 0, 250.26, 70.72),
        ]))).not.toThrow();
    });

    it('refuses two acroform mappings naming one form field', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'acroform', ourField: 'owner.name', pdfField: 'Text1' },
            { kind: 'acroform', ourField: 'property.address', pdfField: 'Text1' },
        ]))).toThrow(/Text1/);
    });

    it('POSITIVE CONTROL — two acroform mappings naming two fields validate', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'acroform', ourField: 'owner.name', pdfField: 'Text1' },
            { kind: 'acroform', ourField: 'property.address', pdfField: 'Text2' },
        ]))).not.toThrow();
    });

    it('refuses two marks at one coordinate, whichever answers they carry', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'inspected', page: 1, x: 40, y: 700 },
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 1, x: 40, y: 700 },
        ]))).toThrow(/40/);
    });

    it('refuses a mark drawn into the box an overlay already writes into', () => {
        expect(() => validateFieldMapShape(MAP([
            overlay('owner.name', 2, 88.9, 451.5),
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 2, x: 88.9, y: 451.5 },
        ]))).toThrow(/88\.9/);
    });

    it('refuses a signature box anchored where a value is already drawn', () => {
        expect(() => validateFieldMapShape(MAP([
            overlay('owner.name', 0, 43.2, 142.2),
            {
                kind: 'signature', ourField: 'inspector.signature', scope: 'whole_form',
                page: 0, x: 43.2, y: 142.2, width: 120, height: 24,
            },
        ]))).toThrow(/43\.2/);
    });

    it('names BOTH mappings, because the reader has to know which to move', () => {
        expect(() => validateFieldMapShape(MAP([
            overlay('owner.name', 0, 116.8, 70.72),
            overlay('property.address', 0, 116.8, 70.72),
        ]))).toThrow(/owner\.name[\s\S]*property\.address/);
    });
});

describe('a value the form prints more than once', () => {
    it('ALLOWS one field drawn in all six page footers — that is the 1802', () => {
        // Measured on FL OIR-B1-1802: `inspector_initials` and
        // `property_address` are printed in the footer of every page, at six
        // different coordinates. This is the case the old rule refused.
        const footers: FieldMapping[] = [];
        for (let page = 0; page < 6; page += 1) {
            footers.push(overlay('inspector_initials', page, 116.8, 70.72));
            footers.push(overlay('property_address', page, 250.26, 70.72));
        }
        expect(() => validateFieldMapShape(MAP(footers))).not.toThrow();
    });

    it('ALLOWS one part of a date drawn into two separate printed blanks', () => {
        // Same shape one level down: a form that prints the year twice prints
        // it twice. What made this a duplicate before was the FIELD repeating,
        // and a field repeating is what these forms do.
        const parts = (page: number, x: number): FieldMapping[] => ([
            { kind: 'overlay', ourField: 'permit.date', part: 'date_month', page, x, y: 500, size: 9, maxWidth: 12, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit.date', part: 'date_day', page, x: x + 20, y: 500, size: 9, maxWidth: 12, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit.date', part: 'date_year', page, x: x + 40, y: 500, size: 9, maxWidth: 24, maxHeight: 11 },
        ]);
        expect(() => validateFieldMapShape(MAP([...parts(0, 100), ...parts(1, 100)]))).not.toThrow();
    });
});

describe('the rules that are about the field rather than its target', () => {
    it('still refuses two boxes carrying one answer to one question', () => {
        // NOT reachable through the coordinate key: a pasted mapping whose
        // coordinate WAS re-measured and whose `whenValue` was not ticks two
        // boxes for one answer. The coordinates differ, so only the field-level
        // rule sees it.
        expect(() => validateFieldMapShape(MAP([
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 0, x: 40, y: 700 },
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 0, x: 40, y: 680 },
        ]))).toThrow(/deficient/);
    });

    it('POSITIVE CONTROL — two boxes carrying two answers validate', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 0, x: 40, y: 700 },
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'inspected', page: 0, x: 40, y: 680 },
        ]))).not.toThrow();
    });

    it('still refuses a value drawn both in parts and as a whole', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'overlay', ourField: 'permit.date', part: 'date_month', page: 0, x: 100, y: 500, size: 9, maxWidth: 12, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit.date', part: 'date_day', page: 0, x: 120, y: 500, size: 9, maxWidth: 12, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit.date', part: 'date_year', page: 0, x: 140, y: 500, size: 9, maxWidth: 24, maxHeight: 11 },
            overlay('permit.date', 0, 300, 500),
        ]))).toThrow(/permit\.date/);
    });

    it('still refuses a field mapped as both a checkbox and a single value', () => {
        expect(() => validateFieldMapShape(MAP([
            { kind: 'checkbox', ourField: 'roof.rating', whenValue: 'deficient', page: 0, x: 40, y: 700 },
            overlay('roof.rating', 0, 200, 700),
        ]))).toThrow(/roof\.rating/);
    });
});
