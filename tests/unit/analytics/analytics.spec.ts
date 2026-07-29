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
const CTX = { sectionTitles: SECTIONS, systems: [{ id: 'rs-default', name: 'Default', levels: LEVELS }] };

/** The single-system matrix — what every case below except the multi-system ones asserts on. */
const only = (out: ReturnType<typeof summariseFindings>) => out.systems[0] ?? { columns: [], rows: [], total: 0, systemId: '', systemName: '' };

/** A findingKey as `applyResultsBatch` writes it: `unit:section:item`. */
const key = (section: string, item: string) => `_default:${section}:${item}`;

describe('summariseFindings (IA-82)', () => {
    it('returns an empty matrix when no inspections exist', () => {
        const out = summariseFindings([], CTX);
        expect(only(out).rows).toEqual([]);
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

        const roof = only(out).rows.find(r => r.section === 'Roof');
        const elec = only(out).rows.find(r => r.section === 'Electrical');
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
        expect(only(out).columns.map(c => c.key)).toEqual(['satisfactory', 'monitor', 'marginal', 'defect']);
        const roof = only(out).rows.find(r => r.section === 'Roof');
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
        expect(only(out).columns.map(c => c.label)).not.toContain('Not Inspected');
        expect(only(out).columns.map(c => c.label)).not.toContain('Not Present');
        expect(only(out).rows.find(r => r.section === 'Roof')?.total).toBe(1);
        expect(out.unresolved).toBe(0);
    });

    it('resolves legacy envelopes that stored the label instead of the id', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: 'Satisfactory' }, [key('sec-roof', 'i-2')]: { rating: 'D' } },
        ], CTX);
        const roof = only(out).rows.find(r => r.section === 'Roof');
        expect(roof?.counts.satisfactory).toBe(1);
        expect(roof?.counts.defect).toBe(1);
        expect(out.unresolved).toBe(0);
    });

    it('flags a section the templates no longer define, and sinks it to the bottom', () => {
        const out = summariseFindings([
            {
                [key('sec-deleted', 'i-1')]: { rating: 'lv-sat' },
                [key('sec-deleted', 'i-2')]: { rating: 'lv-sat' },
                [key('sec-deleted', 'i-3')]: { rating: 'lv-sat' },
                [key('sec-roof', 'i-4')]: { rating: 'lv-sat' },
            },
        ], CTX);
        // The catch-all row outweighs Roof 3:1 and still sorts last — it is
        // bookkeeping, not a section anyone inspected. The flag (not the string)
        // is what the frontend keys its label off.
        expect(only(out).rows.map(r => r.section)).toEqual(['Roof', 'Unknown']);
        expect(only(out).rows[1].unresolvedSection).toBe(true);
        expect(only(out).rows[0].unresolvedSection).toBeUndefined();
    });

    it('counts unmatched ratings as unresolved rather than inventing a column', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'i-1')]: { rating: 'lv-from-a-deleted-system' } },
        ], CTX);
        expect(out.unresolved).toBe(1);
        expect(out.total).toBe(0);
        expect(only(out).rows).toEqual([]);
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
        expect(only(out).rows.map(r => r.section)).toEqual(['Roof', 'Electrical']);
    });
});

/**
 * Multiple rating systems in one tenant.
 *
 * Systems are NOT commensurable and are never merged into one table. `Defect`
 * (OI default), `Deficient` (TREC) and `Deficiency` (ITB) name one severity
 * band in three vocabularies; unioning them produces three sparse columns whose
 * order is meaningless, because a level's `order` is an index within its own
 * system. A row total spanning two systems counts real findings but describes a
 * distribution nobody can compare. So each system gets its own matrix and the
 * frontend shows one at a time.
 */
const TREC: HeatmapLevel[] = [
    { id: 'tr-ins', label: 'Inspected',     abbreviation: 'I',  color: '#10b981', severity: 'good',        isDefect: false, order: 0 },
    { id: 'tr-ni',  label: 'Not Inspected', abbreviation: 'NI', color: '#94a3b8', severity: 'minor',       isDefect: false, order: 1 },
    { id: 'tr-def', label: 'Deficient',     abbreviation: 'D',  color: '#ef4444', severity: 'significant', isDefect: true,  order: 3 },
];

const MULTI = {
    sectionTitles: SECTIONS,
    systems: [
        { id: 'rs-default', name: 'OpenInspection Default', levels: LEVELS },
        { id: 'rs-trec',    name: 'TREC (Texas REC)',       levels: TREC },
    ],
};

describe('summariseFindings across several rating systems', () => {
    it('keeps each system in its own matrix rather than merging vocabularies', () => {
        const out = summariseFindings([
            {
                [key('sec-roof', 'i-1')]: { rating: 'lv-def' },  // OI default
                [key('sec-roof', 'i-2')]: { rating: 'tr-def' },  // TREC
                [key('sec-elec', 'i-3')]: { rating: 'tr-ins' },  // TREC
            },
        ], MULTI);

        expect(out.systems).toHaveLength(2);
        const trec = out.systems.find(s => s.systemId === 'rs-trec')!;
        const def = out.systems.find(s => s.systemId === 'rs-default')!;

        // Neither system's columns leak into the other.
        expect(def.columns.map(c => c.label)).toEqual(['Satisfactory', 'Monitor', 'Marginal', 'Defect']);
        expect(trec.columns.map(c => c.label)).toEqual(['Inspected', 'Deficient']);
        expect(trec.total).toBe(2);
        expect(def.total).toBe(1);
        // The grand total is the denominator behind "N more findings not shown".
        expect(out.total).toBe(3);
    });

    it('orders systems by volume so the busiest is the default view', () => {
        const out = summariseFindings([
            {
                [key('sec-roof', 'a')]: { rating: 'lv-def' },
                [key('sec-roof', 'b')]: { rating: 'tr-def' },
                [key('sec-roof', 'c')]: { rating: 'tr-def' },
                [key('sec-roof', 'd')]: { rating: 'tr-ins' },
            },
        ], MULTI);
        expect(out.systems.map(s => s.systemId)).toEqual(['rs-trec', 'rs-default']);
    });

    it('omits a system that produced nothing in the window', () => {
        const out = summariseFindings([
            { [key('sec-roof', 'a')]: { rating: 'lv-def' } },
        ], MULTI);
        // No selector should appear for a system with no findings to show.
        expect(out.systems.map(s => s.systemId)).toEqual(['rs-default']);
    });

    it("excludes each system's own Not Inspected level, not just the first system's", () => {
        const out = summariseFindings([
            { [key('sec-roof', 'a')]: { rating: 'tr-ni' }, [key('sec-roof', 'b')]: { rating: 'lv-ni' } },
        ], MULTI);
        expect(out.total).toBe(0);
        expect(out.unresolved).toBe(0);
        expect(out.systems).toEqual([]);
    });

    it('attributes an ambiguous legacy abbreviation to the first system defining it', () => {
        // Both systems abbreviate their defect level "D". Once the envelope has
        // lost the id there is no better answer than a deterministic one — but
        // it must be deterministic, not dependent on iteration order.
        const out = summariseFindings([{ [key('sec-roof', 'a')]: { rating: 'D' } }], MULTI);
        expect(out.systems.map(s => s.systemId)).toEqual(['rs-default']);
        expect(out.systems[0].rows[0].counts.defect).toBe(1);
    });
});
