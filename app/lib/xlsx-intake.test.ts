/**
 * The two name questions the browser workbook reader has to answer.
 *
 * Both are about a NAME and nothing else, which is why they live apart from the
 * loader and the conversion layer: no ExcelJS, no DOM, no `File`. What the
 * suffix list claims is a claim about what ExcelJS can actually read, and what
 * `csvFileNameFor` produces is one half of a contract with the server — the
 * other half is asserted across the module boundary in
 * `tests/unit/migration-intake/browser-csv-upload-contract.spec.ts`.
 */
import { describe, expect, it } from 'vitest';

import { csvFileNameFor, isWorkbookFileName, WORKBOOK_SUFFIXES } from './xlsx-intake';

describe('isWorkbookFileName', () => {
    it('claims .xlsx, whatever case the operator machine wrote it in', () => {
        expect(isWorkbookFileName('Contacts.xlsx')).toBe(true);
        expect(isWorkbookFileName('CONTACTS.XLSX')).toBe(true);
    });

    it('refuses .xls, because ExcelJS cannot read the pre-2007 binary format', () => {
        // Not a nicety. Claiming `.xls` would take a file that reaches a person
        // today — uploaded whole, converted by hand — and turn it into a parse
        // error in the browser, which helps nobody.
        expect(isWorkbookFileName('Contacts.xls')).toBe(false);
    });

    it('refuses .xlsm', () => {
        // Deliberately narrower than what the server stores as binary. See the
        // spec's Open findings: widening the browser reader would route more
        // traffic onto a path this sub-project does not own.
        expect(isWorkbookFileName('Contacts.xlsm')).toBe(false);
    });

    it('refuses the formats that are not workbooks at all', () => {
        expect(isWorkbookFileName('contacts.csv')).toBe(false);
        expect(isWorkbookFileName('template.json')).toBe(false);
        expect(isWorkbookFileName('export.zip')).toBe(false);
        expect(isWorkbookFileName('contacts')).toBe(false);
    });

    it('claims exactly one suffix, and it is the one above', () => {
        // The positive control for the four refusals: a list that claimed
        // everything would pass none of them, and a list that claimed nothing
        // would pass all four while breaking the first case. Pin the list.
        expect([...WORKBOOK_SUFFIXES]).toEqual(['.xlsx']);
    });
});

describe('csvFileNameFor', () => {
    it('keeps the base name, names the sheet, and ends .csv', () => {
        expect(csvFileNameFor('Contacts export.xlsx', 'Sheet 1'))
            .toBe('Contacts export - Sheet 1.csv');
    });

    it('replaces characters a file name cannot carry', () => {
        // A sheet may be named `Q1/Q2`; a file may not.
        expect(csvFileNameFor('Contacts.xlsx', 'Q1/Q2')).toBe('Contacts - Q1-Q2.csv');
    });

    it('strips the workbook suffix whatever case it was written in', () => {
        expect(csvFileNameFor('CONTACTS.XLSX', 'Contacts')).toBe('CONTACTS - Contacts.csv');
    });

    it('still ends .csv when the sheet name is entirely punctuation', () => {
        // Positive control for the sanitiser: it must never be able to produce
        // a name the server reads as something other than CSV, and the way that
        // would happen is a name that sanitises down to nothing at all.
        const name = csvFileNameFor('Contacts.xlsx', '///');
        expect(name.endsWith('.csv')).toBe(true);
        expect(name.length).toBeGreaterThan('.csv'.length);
    });
});
