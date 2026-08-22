/**
 * The scanner that refuses a file and never cleans it.
 *
 * Two properties are asserted here that no type can express, and both are the
 * reason the module exists rather than incidental to it:
 *
 *  1. A hit carries a PAGE and a CATEGORY and nothing else. Echoing the matched
 *     text would copy the personal information into the interface, the logs and
 *     any error report — while refusing the file for containing it.
 *  2. Nothing exported removes anything. A remover that misses issues a clean
 *     bill of health for something that is not clean; a refuser that misses
 *     merely fails to help, having asserted nothing.
 *
 * Every "this is a hit" case is paired with a passing one of the same shape.
 * A scanner that flagged every page would satisfy the failures alone, and it
 * would refuse every upload including the blank templates this flow pushes
 * people towards.
 */
import { describe, it, expect } from 'vitest';
import { scanForPii } from '../../../server/lib/migration-intake/pii-scan';

describe('scanForPii — what a hit says', () => {
    it('finds an email and reports its page and category — never its text', () => {
        const hits = scanForPii(['Prepared for zoe@example.test']);
        expect(hits).toEqual([{ page: 0, category: 'email' }]);
        expect(JSON.stringify(hits)).not.toMatch(/zoe@example\.test/);
    });

    it('reports the page so the operator can fix it', () => {
        const hits = scanForPii(['clean', 'clean', 'Owner: Zoe Ng']);
        expect(hits[0]?.page).toBe(2);
    });

    it('reports one hit per category per page, however many times it matched', () => {
        // Otherwise a page listing forty clients produces forty findings that
        // say the same thing, and the operator scrolls past the one page that
        // carries a second, different category.
        const hits = scanForPii(['a@example.test b@example.test c@example.test']);
        expect(hits).toEqual([{ page: 0, category: 'email' }]);
    });

    it('keeps hits in page order', () => {
        const hits = scanForPii(['clean', 'x@example.test', 'clean', 'Owner: Zoe Ng']);
        expect(hits.map((h) => h.page)).toEqual([1, 3]);
    });
});

describe('scanForPii — the categories', () => {
    it('finds a street address even with no name beside it', () => {
        // An address is not safe merely because no name accompanies it.
        expect(scanForPii(['123 Main Street, Springfield']).map((h) => h.category))
            .toContain('address');
    });

    it('finds a telephone number', () => {
        expect(scanForPii(['Call (555) 010-4477 to arrange access']).map((h) => h.category))
            .toContain('phone');
    });

    it('finds a licence number', () => {
        expect(scanForPii(['Inspector licence no. 44821']).map((h) => h.category))
            .toContain('licence');
    });

    it('finds a signature block', () => {
        expect(scanForPii(['Electronically signed by the inspector']).map((h) => h.category))
            .toContain('signature');
    });

    it('finds a labelled personal name', () => {
        expect(scanForPii(['Client: Amara Osei']).map((h) => h.category)).toContain('name');
    });
});

describe('scanForPii — positive controls', () => {
    it('POSITIVE CONTROL — a blank template page produces no hits', () => {
        // Without this, everything above passes for a scanner that flags every
        // page, which would refuse every upload including the ones we push
        // people towards.
        expect(scanForPii(['Roof', 'Covering', 'Comments'])).toEqual([]);
    });

    it('POSITIVE CONTROL — an empty labelled field is what a blank template IS', () => {
        // The blank template a vendor prints has every label and no value. If
        // the label alone were a hit, the file we ask for would be the file we
        // refuse.
        expect(scanForPii([
            'Client Name: ______________',
            'Property Address: ______________',
            'Telephone: (   )',
            'Signature',
        ])).toEqual([]);
    });

    it('POSITIVE CONTROL — numbers that are not addresses or phones stay quiet', () => {
        expect(scanForPii([
            'Section 3 of 12',
            'Built 1974, 2400 sq ft',
            'Water heater rated 40 gallons, installed 03/2019',
        ])).toEqual([]);
    });

    it('POSITIVE CONTROL — an empty document produces no hits', () => {
        expect(scanForPii([])).toEqual([]);
    });
});

describe('scanForPii — the architecture', () => {
    it('exposes NO function that removes anything', async () => {
        // The architectural assertion. A remover appearing here later would
        // make us the party asserting the file is clean, which is the posture
        // this design refuses.
        const mod = await import('../../../server/lib/migration-intake/pii-scan');
        expect(Object.keys(mod).some((k) => /redact|scrub|clean|strip/i.test(k))).toBe(false);
    });

    it('exports a scanner and nothing that returns a document', async () => {
        // The complement of the assertion above, which on its own is satisfied
        // by a module exporting nothing at all. A function whose return value
        // is text is a rewritten document however it is named.
        const mod = await import('../../../server/lib/migration-intake/pii-scan');
        expect(Object.keys(mod)).toContain('scanForPii');
        expect(typeof mod.scanForPii(['Owner: Zoe Ng'])).toBe('object');
    });
});
