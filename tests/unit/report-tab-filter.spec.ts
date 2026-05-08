import { describe, it, expect } from 'vitest';
import { filterSectionsByTab, type ReportTabSection } from '../../src/templates/components/report-tab-bar';

const sections: ReportTabSection[] = [
    {
        id: 'roof',
        title: 'Roof',
        items: [
            { id: 'cover', label: 'Roof Covering', rating: 'satisfactory', defects: { safety: 0, recommendation: 0, maintenance: 0 }, notes: 'OK' },
            { id: 'flash', label: 'Roof Flashing', rating: 'defect', defects: { safety: 0, recommendation: 1, maintenance: 0 }, notes: 'Cracked' },
        ],
    },
    {
        id: 'elec',
        title: 'Electrical',
        items: [
            { id: 'panel', label: 'Main Panel', rating: 'defect', defects: { safety: 1, recommendation: 0, maintenance: 0 }, notes: 'Hazardous' },
        ],
    },
    {
        id: 'plumb',
        title: 'Plumbing',
        items: [
            { id: 'water-heater', label: 'Water Heater', rating: 'monitor', defects: { safety: 0, recommendation: 0, maintenance: 1 }, notes: 'Aging unit' },
        ],
    },
];

describe('filterSectionsByTab', () => {
    it('full tab returns every section and item untouched', () => {
        const r = filterSectionsByTab(sections, 'full');
        expect(r.length).toBe(3);
        expect(r[0]?.items.length).toBe(2);
    });

    it('summary tab keeps only items with at least one defect/recommendation/maintenance', () => {
        const r = filterSectionsByTab(sections, 'summary');
        // Roof keeps only "flash"; Electrical keeps "panel"; Plumbing keeps water-heater (maintenance counts).
        expect(r.length).toBe(3);
        expect(r[0]?.items.length).toBe(1);
        expect(r[0]?.items[0]?.id).toBe('flash');
    });

    it('safety tab keeps only items with safety > 0', () => {
        const r = filterSectionsByTab(sections, 'safety');
        expect(r.length).toBe(1);
        expect(r[0]?.id).toBe('elec');
        expect(r[0]?.items.length).toBe(1);
        expect(r[0]?.items[0]?.id).toBe('panel');
    });

    it('drops sections that have zero items after filtering', () => {
        const r = filterSectionsByTab(sections, 'safety');
        expect(r.find((s) => s.id === 'roof')).toBeUndefined();
        expect(r.find((s) => s.id === 'plumb')).toBeUndefined();
    });

    it('returns the original list when given full tab', () => {
        const r = filterSectionsByTab(sections, 'full');
        // Object identity is OK to break, but length + ids must match.
        expect(r.map((s) => s.id)).toEqual(['roof', 'elec', 'plumb']);
    });

    it('does not mutate the input sections', () => {
        const before = JSON.stringify(sections);
        filterSectionsByTab(sections, 'summary');
        filterSectionsByTab(sections, 'safety');
        expect(JSON.stringify(sections)).toBe(before);
    });
});
