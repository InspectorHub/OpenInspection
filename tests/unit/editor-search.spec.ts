import { describe, it, expect } from 'vitest';
import {
    normalizeQuery,
    itemMatches,
    sectionMatches,
    filterSections,
    highlightMatches,
    type SearchableSection,
    type SearchableResults,
} from '../../server/lib/editor-search';

/**
 * Competitor parity App.E.3 (Spectora) — editor full-text search.
 * Pure-function tests for the filter helpers used by inspection-edit.tsx.
 */
describe('editor-search', () => {
    const sections: SearchableSection[] = [
        {
            id: 'roof',
            title: 'Roof',
            items: [
                { id: 'cover',  label: 'Roof Covering' },
                { id: 'flash',  label: 'Roof Flashing' },
            ],
        },
        {
            id: 'elec',
            title: 'Electrical',
            items: [
                { id: 'panel',  label: 'Main Panel' },
                { id: 'gfci',   label: 'GFCI Outlets' },
            ],
        },
        {
            id: 'plumb',
            title: 'Plumbing',
            items: [
                { id: 'wh',     label: 'Water Heater' },
            ],
        },
    ];

    const results: SearchableResults = {
        cover: { notes: 'Asphalt shingles in good shape' },
        flash: { notes: 'Cracked at chimney; needs sealant' },
        panel: { notes: 'Federal Pacific panel — recommend replacement' },
        gfci:  {
            notes: '',
            cannedComments: {
                defects: [
                    { cannedId: 'd1', title: 'Reverse polarity', comment: 'Outlet wired in reverse' },
                ],
            },
        },
        wh:    {
            notes: '',
            customComments: {
                defects: [
                    { id: 'c1', title: 'Rusted base', comment: 'Visible corrosion at tank base', location: 'Garage' },
                ],
            },
        },
    };

    describe('normalizeQuery', () => {
        it('lowercases and trims', () => {
            expect(normalizeQuery('  Roof  ')).toBe('roof');
        });
        it('returns empty for nullish input', () => {
            expect(normalizeQuery(null)).toBe('');
            expect(normalizeQuery(undefined)).toBe('');
            expect(normalizeQuery('')).toBe('');
            expect(normalizeQuery('   ')).toBe('');
        });
    });

    describe('itemMatches', () => {
        const roof = sections[0]!;
        const cover = roof.items[0]!;
        const flash = roof.items[1]!;

        it('empty query matches everything', () => {
            expect(itemMatches(roof, cover, results, '')).toBe(true);
            expect(itemMatches(roof, cover, results, '   ')).toBe(true);
        });
        it('matches on item label (case-insensitive)', () => {
            expect(itemMatches(roof, cover, results, 'covering')).toBe(true);
            expect(itemMatches(roof, cover, results, 'COVERING')).toBe(true);
        });
        it('matches on section title (so the whole section surfaces)', () => {
            expect(itemMatches(roof, cover, results, 'roof')).toBe(true);
        });
        it('matches on result notes', () => {
            expect(itemMatches(roof, flash, results, 'chimney')).toBe(true);
            expect(itemMatches(roof, cover, results, 'asphalt')).toBe(true);
        });
        it('matches on canned-comment title and comment text', () => {
            const elec = sections[1]!;
            const gfci = elec.items[1]!;
            expect(itemMatches(elec, gfci, results, 'reverse polarity')).toBe(true);
            expect(itemMatches(elec, gfci, results, 'wired in reverse')).toBe(true);
        });
        it('matches on custom-comment title, comment, location', () => {
            const plumb = sections[2]!;
            const wh = plumb.items[0]!;
            expect(itemMatches(plumb, wh, results, 'rusted')).toBe(true);
            expect(itemMatches(plumb, wh, results, 'corrosion')).toBe(true);
            expect(itemMatches(plumb, wh, results, 'garage')).toBe(true);
        });
        it('returns false when nothing matches', () => {
            expect(itemMatches(roof, cover, results, 'asbestos')).toBe(false);
        });
    });

    describe('sectionMatches', () => {
        it('matches when section title contains query', () => {
            expect(sectionMatches(sections[0]!, results, 'roof')).toBe(true);
        });
        it('matches when any item matches', () => {
            expect(sectionMatches(sections[1]!, results, 'gfci')).toBe(true);
            expect(sectionMatches(sections[1]!, results, 'federal pacific')).toBe(true);
        });
        it('returns false when no item matches', () => {
            expect(sectionMatches(sections[2]!, results, 'asbestos')).toBe(false);
        });
        it('empty query matches every section', () => {
            for (const s of sections) {
                expect(sectionMatches(s, results, '')).toBe(true);
            }
        });
    });

    describe('filterSections', () => {
        it('empty query returns all sections (with all items)', () => {
            const out = filterSections(sections, results, '');
            expect(out.length).toBe(3);
            expect(out[0]!.items.length).toBe(2);
        });

        it('section-title hit keeps every item in that section', () => {
            const out = filterSections(sections, results, 'electrical');
            expect(out.length).toBe(1);
            expect(out[0]!.id).toBe('elec');
            expect(out[0]!.items.length).toBe(2); // both items kept
        });

        it('item-label hit keeps only matching items in their section', () => {
            const out = filterSections(sections, results, 'gfci');
            expect(out.length).toBe(1);
            expect(out[0]!.items.length).toBe(1);
            expect(out[0]!.items[0]!.id).toBe('gfci');
        });

        it('notes hit surfaces the right item', () => {
            const out = filterSections(sections, results, 'chimney');
            expect(out.length).toBe(1);
            expect(out[0]!.id).toBe('roof');
            expect(out[0]!.items.length).toBe(1);
            expect(out[0]!.items[0]!.id).toBe('flash');
        });

        it('drops sections with zero matches', () => {
            const out = filterSections(sections, results, 'asbestos');
            expect(out.length).toBe(0);
        });

        it('does not mutate input', () => {
            const before = JSON.stringify(sections);
            filterSections(sections, results, 'roof');
            filterSections(sections, results, 'gfci');
            expect(JSON.stringify(sections)).toBe(before);
        });
    });

    describe('highlightMatches', () => {
        it('wraps the matched substring in <mark>', () => {
            expect(highlightMatches('Roof Covering', 'roof')).toBe('<mark>Roof</mark> Covering');
        });
        it('preserves original casing of the source text', () => {
            expect(highlightMatches('Roof Covering', 'COV')).toBe('Roof <mark>Cov</mark>ering');
        });
        it('escapes HTML metacharacters in source text', () => {
            expect(highlightMatches('A&B<C>', 'b')).toBe('A&amp;<mark>B</mark>&lt;C&gt;');
        });
        it('returns the (escaped) text unchanged when query is empty', () => {
            expect(highlightMatches('Roof', '')).toBe('Roof');
            expect(highlightMatches('A&B', '')).toBe('A&amp;B');
        });
        it('returns empty string for null / undefined', () => {
            expect(highlightMatches(null, 'roof')).toBe('');
            expect(highlightMatches(undefined, 'roof')).toBe('');
        });
        it('handles regex meta characters in query', () => {
            // Should not throw, and should literal-match the parens.
            expect(highlightMatches('GFCI (Bath)', '(bath)')).toBe('GFCI <mark>(Bath)</mark>');
        });
        it('matches multiple occurrences (global flag)', () => {
            expect(highlightMatches('Roof and Roof again', 'roof'))
                .toBe('<mark>Roof</mark> and <mark>Roof</mark> again');
        });
    });
});
