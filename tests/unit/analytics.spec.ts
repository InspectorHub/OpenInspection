/**
 * Design System 0520 subsystem E P7.1 — analytics aggregator tests.
 *
 * The AnalyticsService is a thin DB wrapper; the pure aggregators in
 * server/lib/analytics.ts contain the actual logic and are unit-tested
 * here without any DB plumbing.
 */
import { describe, it, expect } from 'vitest';
import { groupInspectionsByMonth, summariseHeatmap } from '../../server/lib/analytics';

describe('groupInspectionsByMonth (subsystem E P7.1)', () => {
    it('returns N empty buckets when no inspections exist', () => {
        const out = groupInspectionsByMonth([], '2026-05', 12);
        expect(out).toHaveLength(12);
        expect(out[11]).toEqual({ ym: '2026-05', count: 0 });
        expect(out[0]).toEqual({ ym: '2025-06', count: 0 });
    });

    it('buckets inspections by created_at month', () => {
        const out = groupInspectionsByMonth(
            [
                { createdAt: '2026-05-01T10:00:00Z' },
                { createdAt: '2026-05-15T14:00:00Z' },
                { createdAt: '2026-04-20T09:00:00Z' },
                { createdAt: '2026-03-05T08:00:00Z' },
            ],
            '2026-05',
            6,
        );
        const apr = out.find(b => b.ym === '2026-04');
        const may = out.find(b => b.ym === '2026-05');
        const mar = out.find(b => b.ym === '2026-03');
        expect(may?.count).toBe(2);
        expect(apr?.count).toBe(1);
        expect(mar?.count).toBe(1);
    });

    it('drops inspections older than the window', () => {
        const out = groupInspectionsByMonth(
            [
                { createdAt: '2024-01-01T00:00:00Z' }, // outside 6-month window from May 2026
                { createdAt: '2026-05-01T00:00:00Z' },
            ],
            '2026-05',
            6,
        );
        const total = out.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(1);
    });

    it('handles Date objects as well as ISO strings', () => {
        const out = groupInspectionsByMonth(
            [
                { createdAt: new Date('2026-05-10') },
                { createdAt: new Date('2026-05-11') },
            ],
            '2026-05',
            3,
        );
        expect(out.find(b => b.ym === '2026-05')?.count).toBe(2);
    });
});

describe('summariseHeatmap (subsystem E P7.1)', () => {
    it('returns empty cells when no inspections exist', () => {
        expect(summariseHeatmap([])).toEqual({ cells: [] });
    });

    it('counts ratings per (section, category) bucket', () => {
        const out = summariseHeatmap([
            {
                'i-1': { sectionName: 'Roof', rating: 'Defect' },
                'i-2': { sectionName: 'Roof', rating: 'Defect' },
                'i-3': { sectionName: 'Roof', rating: 'Satisfactory' },
            },
            {
                'i-4': { sectionName: 'Electrical', rating: 'Monitor' },
            },
        ]);
        const roofDef = out.cells.find(c => c.section === 'Roof' && c.category === 'Defect');
        const roofSat = out.cells.find(c => c.section === 'Roof' && c.category === 'Satisfactory');
        const elecMon = out.cells.find(c => c.section === 'Electrical' && c.category === 'Monitor');
        expect(roofDef?.count).toBe(2);
        expect(roofSat?.count).toBe(1);
        expect(elecMon?.count).toBe(1);
    });

    it('groups items without a sectionName under "Unknown"', () => {
        const out = summariseHeatmap([
            { 'i-1': { rating: 'Satisfactory' } },
        ]);
        const cell = out.cells.find(c => c.section === 'Unknown');
        expect(cell?.count).toBe(1);
    });

    it('ignores items without a rating', () => {
        const out = summariseHeatmap([
            { 'i-1': { sectionName: 'Roof' /* no rating */ } },
        ]);
        expect(out.cells).toEqual([]);
    });
});
