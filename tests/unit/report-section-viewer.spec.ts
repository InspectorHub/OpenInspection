/**
 * ReportCardStackPage render tests — Competitor parity App.F.4 (Spectora).
 *
 * Asserts the published-report viewer:
 *   - numbers visible sections starting at 1 ("3 - Roof")
 *   - shows the EDIT SECTION button only for inspector / admin / owner
 *   - never shows EDIT SECTION for public viewers (no role) or agents
 *   - emits a stable `id="section-{id}"` anchor so the editor deep-link
 *     can scroll the right section into view
 *
 * Uses String(JSXNode) — hono/jsx materialises HTML server-side without
 * needing a DOM.
 */

import { describe, it, expect } from 'vitest';
import { ReportCardStackPage } from '../../src/templates/pages/report-card-stack';
import type { RatingLevel } from '../../src/lib/report-utils';

function render(node: unknown): string {
    return String(node);
}

const ratingLevels: RatingLevel[] = [
    { id: 'sat',    label: 'Satisfactory', abbreviation: 'Sat', color: '#22c55e', severity: 'good',        isDefect: false },
    { id: 'mon',    label: 'Monitor',      abbreviation: 'Mon', color: '#f59e0b', severity: 'marginal',    isDefect: false },
    { id: 'defect', label: 'Defect',       abbreviation: 'Def', color: '#f43f5e', severity: 'significant', isDefect: true  },
];

const baseProps = {
    inspectionId: 'insp-abc',
    address: '123 Main St',
    date: 'May 8, 2026',
    inspectorName: 'Jane Inspector',
    theme: 'modern' as const,
    stats: { total: 6, satisfactory: 3, monitor: 1, defect: 2 },
    ratingLevels,
    sections: [
        {
            id: 'roof',
            title: 'Roof',
            icon: null,
            defectCount: 1,
            items: [
                { id: 'cover', label: 'Roof Covering', rating: 'sat',    ratingColor: '#22c55e', ratingLabel: 'Sat', severityBucket: 'satisfactory', notes: 'OK',     photos: [] },
                { id: 'flash', label: 'Roof Flashing', rating: 'defect', ratingColor: '#f43f5e', ratingLabel: 'Def', severityBucket: 'defect',       notes: 'Cracked', photos: [] },
            ],
        },
        {
            id: 'elec',
            title: 'Electrical',
            icon: null,
            defectCount: 0,
            items: [
                { id: 'panel', label: 'Main Panel', rating: 'sat', ratingColor: '#22c55e', ratingLabel: 'Sat', severityBucket: 'satisfactory', notes: 'OK', photos: [] },
            ],
        },
        {
            id: 'plumb',
            title: 'Plumbing',
            icon: null,
            defectCount: 1,
            items: [
                { id: 'wh', label: 'Water Heater', rating: 'mon', ratingColor: '#f59e0b', ratingLabel: 'Mon', severityBucket: 'monitor', notes: 'Aging', photos: [] },
            ],
        },
    ],
};

describe('ReportCardStackPage — section numbering (App.F.4)', () => {
    it('numbers visible sections starting at 1', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps }));
        // Each section heading carries a "{N} -" prefix.
        expect(html).toContain('1 -');
        expect(html).toContain('2 -');
        expect(html).toContain('3 -');
        expect(html).toContain('Roof');
        expect(html).toContain('Electrical');
        expect(html).toContain('Plumbing');
    });

    it('emits id="section-{id}" anchor on each section card', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps }));
        expect(html).toContain('id="section-roof"');
        expect(html).toContain('id="section-elec"');
        expect(html).toContain('id="section-plumb"');
    });

    it('numbered <span> uses font-mono styling', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps }));
        // The number span is monospace + theme-text-muted.
        expect(html).toMatch(/font-mono[^>]*>1 -/);
    });

    it('aria-label on heading uses the full numbered string', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps }));
        expect(html).toContain('aria-label="1 - Roof"');
        expect(html).toContain('aria-label="3 - Plumbing"');
    });
});

describe('ReportCardStackPage — EDIT SECTION hover button (App.F.4)', () => {
    it('renders EDIT button for inspector role', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'inspector' }));
        expect(html).toContain('data-testid="report-section-edit"');
        expect(html).toContain('Edit Section');
        // Each section gets its own deep-link.
        expect(html).toContain('href="/inspections/insp-abc/report#section-roof"');
        expect(html).toContain('href="/inspections/insp-abc/report#section-elec"');
        expect(html).toContain('href="/inspections/insp-abc/report#section-plumb"');
    });

    it('renders EDIT button for admin role', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'admin' }));
        expect(html).toContain('data-testid="report-section-edit"');
    });

    it('renders EDIT button for owner role', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'owner' }));
        expect(html).toContain('data-testid="report-section-edit"');
    });

    it('hides EDIT button for agent role', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'agent' }));
        expect(html).not.toContain('data-testid="report-section-edit"');
        expect(html).not.toContain('Edit Section');
    });

    it('hides EDIT button for anonymous public viewer (null role)', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: null }));
        expect(html).not.toContain('data-testid="report-section-edit"');
    });

    it('hides EDIT button when viewerRole prop is omitted entirely', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps }));
        expect(html).not.toContain('data-testid="report-section-edit"');
    });

    it('EDIT button uses no-print class so it disappears in PDFs', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'inspector' }));
        // Tailwind no-print utility — main-layout's print stylesheet hides it.
        // Match the <a> opening tag that carries data-testid AND no-print
        // (attribute order is not guaranteed by hono/jsx, so we check both).
        const matches = html.match(/<a [^>]*data-testid="report-section-edit"[^>]*>/g) ?? [];
        expect(matches.length).toBeGreaterThan(0);
        for (const tag of matches) {
            expect(tag).toContain('no-print');
        }
    });

    it('EDIT button uses opacity-0 + group-hover for hover-only reveal', async () => {
        const html = await render(ReportCardStackPage({ ...baseProps, viewerRole: 'inspector' }));
        expect(html).toMatch(/opacity-0[^"]*group-hover\/section:opacity-100/);
    });
});
