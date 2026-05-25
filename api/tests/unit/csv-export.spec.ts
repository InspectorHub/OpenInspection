/**
 * Design System 0520 subsystem E P3.1 — CSV serialiser tests.
 *
 * Pure helpers (no DOM access in `toCsv`; downloadCsv is exercised
 * separately when needed). All four test cases match the RFC 4180
 * baseline: header row + per-row escape rules for commas, embedded
 * double-quotes, and newlines.
 */
import { describe, it, expect } from 'vitest';
import { toCsv } from '../../public/js/csv-export.js';

describe('toCsv (subsystem E P3.1)', () => {
    it('serialises rows with header line', () => {
        const csv = toCsv([
            { id: 'i-1', address: '123 Main' },
            { id: 'i-2', address: '456 Oak' },
        ]);
        expect(csv).toBe('id,address\ni-1,123 Main\ni-2,456 Oak');
    });

    it('quotes values containing commas', () => {
        const csv = toCsv([{ name: 'Smith, John' }]);
        expect(csv).toBe('name\n"Smith, John"');
    });

    it('escapes embedded double-quotes by doubling them', () => {
        const csv = toCsv([{ note: 'He said "hi"' }]);
        expect(csv).toBe('note\n"He said ""hi"""');
    });

    it('quotes values containing newlines', () => {
        const csv = toCsv([{ note: 'line one\nline two' }]);
        expect(csv).toBe('note\n"line one\nline two"');
    });

    it('handles empty array', () => {
        expect(toCsv([])).toBe('');
    });

    it('serialises null / undefined as empty strings', () => {
        const csv = toCsv([{ a: null, b: undefined, c: 'x' }]);
        expect(csv).toBe('a,b,c\n,,x');
    });

    it('preserves header column order from the first row', () => {
        const csv = toCsv([
            { c: 3, a: 1, b: 2 },
            { c: 6, a: 4, b: 5 },
        ]);
        expect(csv).toBe('c,a,b\n3,1,2\n6,4,5');
    });
});
