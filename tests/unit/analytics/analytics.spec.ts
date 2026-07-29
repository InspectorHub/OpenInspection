/**
 * Design System 0520 subsystem E P7.1 — analytics aggregator tests.
 *
 * The AnalyticsService is a thin DB wrapper; the pure aggregators in
 * server/lib/analytics.ts contain the actual logic and are unit-tested
 * here without any DB plumbing.
 */
import { describe, it, expect } from 'vitest';
import { groupInspectionsByMonth, summariseFindings, type HeatmapLevel } from '../../../server/lib/analytics';

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

/**
 * IA-82 — the findings matrix behind /metrics.
 *
 * The predecessor of this aggregator read `item.sectionName` off each result
 * entry and grouped by the raw `rating` string. Neither field exists in a real
 * envelope: `applyResultsBatch` (and the single-field patch path) writes only
 * `rating | notes | value | canned | defectFields | itemAttribute`, keyed by the
 * composite findingKey, and `rating` holds a rating-level **id**. Its tests
 * passed because they invented the input. Every fixture below is shaped like
 * what the database actually stores.
 */
const LEVELS: HeatmapLevel[] = [
    { id: 'lv-sat', label: 'Satisfactory', abbreviation: 'Sat', color: '#10b981', severity: 'good',        isDefect: false, order: 0 },
    { id: 'lv-mon', label: 'Monitor',      abbreviation: 'Mon', color: '#f59e0b', severity: 'marginal',    isDefect: false, order: 1 },
    { id: 'lv-mar', label: 'Marginal',     abbreviation: 'Mar', color: '#f59e0b', severity: 'marginal',    isDefect: false, order: 2 },
    { id: 'lv-def', label: 'Defect',       abbreviation: 'D',   color: '#ef4444', severity: 'significant', isDefect: true,  order: 3 },
    { id: 'lv-ni',  label: 'Not Inspected', abbreviation: 'NI', color: '#94a3b8', severity: 'minor',       isDefect: false, order: 4 },
    { id: 'lv-np',  label: 'Not Present',   abbreviation: 'NP', color: '#cbd5e1', severity: 'minor',       isDefect: false, order: 5 },
];

const SECTIONS = { 'sec-roof': 'Roof', 'sec-elec': 'Electrical' };
const CTX = { sectionTitles: SECTIONS, levels: LEVELS };

/** A findingKey as `applyResultsBatch` writes it: `unit:section:item`. */
const key = (section: string, item: string) => `_default:${section}:${item}`;

describe('summariseFindings (IA-82)', () => {
    it('returns an empty matrix when no inspections exist', () => {
        const out = summariseFindings([], CTX);
        expect(out.rows).toEqual([]);
        expect(out.total).toBe(0);
    });

    it('counts rating-level ids per template section', () => {
        const out = summariseFindings([
            {
                [key('sec-roof', 'i-1')]: { rating: 'lv-def' },
                [key('sec-roof', 'i-2')]: { rating: 'lv-def' },
                [key('sec-roof', 'i-3')]: { rating: 'lv-sat' },
            },
            { [key('sec-elec', 'i-4')]: { rating: 'lv-mon' } },
        ], CTX);

        const roof = out.rows.find(r => r.section === 'Roof');
        const elec = out.rows.find(r => r.section === 'Electrical');
        expect(roof?.counts.defect).toBe(2);
        expect(roof?.counts.satisfactory).toBe(1);
        expect(roof?.total).toBe(3);
        expect(elec?.counts.monitor).toBe(1);
        expect(out.total).toBe(4);
    });

    it('keeps Monitor and Marginal as separate columns', () => {
        // Both carry severity 'marginal', so any severity-keyed fold would merge
        // them — and Marginal is the most common rating in real commercial data.
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: 'lv-mon' }, [key('sec-roof', 'i-2')]: { rating: 'lv-mar' } },
        ], CTX);
        expect(out.columns.map(c => c.key)).toEqual(['satisfactory', 'monitor', 'marginal', 'defect']);
        const roof = out.rows.find(r => r.section === 'Roof');
        expect(roof?.counts.monitor).toBe(1);
        expect(roof?.counts.marginal).toBe(1);
    });

    it('excludes Not Inspected / Not Present — they are not findings', () => {
        const out = summariseFindings([
            {
                [key('sec-roof', 'i-1')]: { rating: 'lv-ni' },
                [key('sec-roof', 'i-2')]: { rating: 'lv-np' },
                [key('sec-roof', 'i-3')]: { rating: 'lv-sat' },
            },
        ], CTX);
        expect(out.columns.map(c => c.label)).not.toContain('Not Inspected');
        expect(out.columns.map(c => c.label)).not.toContain('Not Present');
        expect(out.rows.find(r => r.section === 'Roof')?.total).toBe(1);
        expect(out.unresolved).toBe(0);
    });

    it('resolves legacy envelopes that stored the label instead of the id', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: 'Satisfactory' }, [key('sec-roof', 'i-2')]: { rating: 'D' } },
        ], CTX);
        const roof = out.rows.find(r => r.section === 'Roof');
        expect(roof?.counts.satisfactory).toBe(1);
        expect(roof?.counts.defect).toBe(1);
        expect(out.unresolved).toBe(0);
    });

    it('files a section the templates no longer define under "Unknown"', () => {
        const out = summariseFindings([
            { [key('sec-deleted', 'i-1')]: { rating: 'lv-sat' } },
        ], CTX);
        expect(out.rows.map(r => r.section)).toEqual(['Unknown']);
    });

    it('counts unmatched ratings as unresolved rather than inventing a column', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: 'lv-from-a-deleted-system' } },
        ], CTX);
        expect(out.unresolved).toBe(1);
        expect(out.total).toBe(0);
        expect(out.rows).toEqual([]);
    });

    it('ignores items with no rating', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: undefined } },
        ], CTX);
        expect(out.total).toBe(0);
        expect(out.unresolved).toBe(0);
    });

    it('orders rows by volume so the busiest section reads first', () => {
        const out = summariseFindings([
            { [key('sec-elec', 'a')]: { rating: 'lv-sat' } },
            {
                [key('sec-roof', 'b')]: { rating: 'lv-sat' },
                [key('sec-roof', 'c')]: { rating: 'lv-def' },
            },
        ], CTX);
        expect(out.rows.map(r => r.section)).toEqual(['Roof', 'Electrical']);
    });
});
