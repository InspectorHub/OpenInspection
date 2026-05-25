/**
 * PageHeader / Breadcrumb / BackButton primitives — render snapshot tests.
 *
 * hono/jsx returns a JSXNode whose toString() materialises full HTML. We use
 * String(node) for the rendering shim — vitest runs in node, no DOM needed.
 *
 * Spec: docs/superpowers/plans/2026-05-08-sprint1-subspec-b-inspector-admin.md Task 1
 */

import { describe, it, expect } from 'vitest';
import { PageHeader } from '../../src/templates/components/page-header';
import { Breadcrumb } from '../../src/templates/components/breadcrumb';
import { BackButton } from '../../src/templates/components/back-button';

function render(node: unknown): string {
    return String(node);
}

describe('PageHeader', () => {
    it('renders title in 22px bold tracking-tight (canonical --ih-text-section)', () => {
        const html = render(PageHeader({ title: 'Inspections' }));
        expect(html).toContain('text-[22px]');
        expect(html).toContain('font-bold');
        expect(html).toContain('tracking-tight');
        expect(html).toContain('Inspections');
    });

    it('does not use forbidden font-black or tracking-tightest on the title', () => {
        const html = render(PageHeader({ title: 'Inspections' }));
        expect(html).not.toContain('font-black');
        expect(html).not.toContain('tracking-tightest');
    });

    it('renders eyebrow with indigo tone classes when eyebrowColor=indigo', () => {
        const html = render(PageHeader({ eyebrow: 'DASHBOARD', eyebrowColor: 'indigo', title: 'Inspections' }));
        expect(html).toContain('DASHBOARD');
        expect(html).toContain('text-indigo-600');
    });

    it('renders eyebrow with emerald tone when eyebrowColor=emerald', () => {
        const html = render(PageHeader({ eyebrow: 'REPORTS', eyebrowColor: 'emerald', title: 'Reports' }));
        expect(html).toContain('text-emerald-600');
    });

    it('defaults eyebrow to slate when no eyebrowColor specified', () => {
        const html = render(PageHeader({ eyebrow: 'TEMPLATES', title: 'Templates' }));
        expect(html).toContain('text-slate-600');
    });

    it('renders breadcrumb with chevron separator U+203A', () => {
        const html = render(PageHeader({
            title: 'Edit',
            breadcrumb: [{ label: 'Inspections', href: '/dashboard' }, { label: 'Edit' }],
        }));
        expect(html).toContain('Inspections');
        expect(html).toContain('›');
    });

    it('forbids "Manage your X" filler副标题 — no built-in default', () => {
        const html = render(PageHeader({ title: 'Inspections' }));
        expect(html).not.toContain('Manage your');
    });

    it('renders meta as string', () => {
        const html = render(PageHeader({ title: 'Templates', meta: '12 templates · 3 imported' }));
        expect(html).toContain('12 templates');
    });

    it('renders actions slot', () => {
        // Build a JSX-like node manually since this is a .spec.ts (not .tsx).
        // hono/jsx exposes jsx() factory for direct construction.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { jsx } = require('hono/jsx');
        const action = jsx('button', { 'data-test': 'action-slot' }, ['+ New']);
        const html = render(PageHeader({ title: 'Inspections', actions: action as JSX.Element }));
        expect(html).toContain('action-slot');
    });
});

describe('Breadcrumb', () => {
    it('returns empty fragment when items is empty', () => {
        const html = render(Breadcrumb({ items: [] }));
        expect(html).not.toContain('aria-label="Breadcrumb"');
    });

    it('marks last item as aria-current=page', () => {
        const html = render(Breadcrumb({
            items: [{ label: 'Inspections', href: '/dashboard' }, { label: 'Edit' }],
        }));
        expect(html).toContain('aria-current="page"');
    });

    it('renders chevron between items but not before first', () => {
        const html = render(Breadcrumb({
            items: [{ label: 'A', href: '/a' }, { label: 'B', href: '/b' }, { label: 'C' }],
        }));
        const chevronCount = (html.match(/›/g) || []).length;
        expect(chevronCount).toBe(2);
    });
});

describe('BackButton', () => {
    it('targets the penultimate breadcrumb item', () => {
        const html = render(BackButton({
            items: [{ label: 'Inspections', href: '/dashboard' }, { label: 'Edit' }],
        }));
        expect(html).toContain('href="/dashboard"');
        expect(html).toContain('Inspections');
    });

    it('falls back to fallbackHref when only one breadcrumb', () => {
        const html = render(BackButton({
            items: [{ label: 'Edit' }],
            fallbackHref: '/inspections',
        }));
        expect(html).toContain('href="/inspections"');
    });

    it('falls back to /dashboard when neither items nor fallbackHref', () => {
        const html = render(BackButton({}));
        expect(html).toContain('href="/dashboard"');
    });

    it('uses ghost button styling (slate-500 with hover-darken), not primary', () => {
        const html = render(BackButton({}));
        expect(html).toContain('text-slate-500');
        expect(html).not.toContain('bg-indigo-600');
    });
});
