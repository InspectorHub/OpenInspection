import { describe, it, expect } from 'vitest';
import { AgentInspectorsPage } from '../../src/templates/pages/agent-inspectors';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

const INSPECTORS = [
    {
        tenantId: 't1', tenantName: 'Acme', tenantSubdomain: 'acme',
        contactId: 'c-1', inspectorName: 'Mike',
        inspectorPhotoUrl: 'https://r2/me.jpg', inspectorSlug: 'mike',
    },
    {
        tenantId: 't2', tenantName: 'BobsInsp', tenantSubdomain: 'bobs',
        contactId: 'c-2', inspectorName: 'Bob',
        inspectorPhotoUrl: null, inspectorSlug: 'bob',
    },
];

// PR 2 — path-tenant booking URLs (`/book/<tenant>/<slug>`) work uniformly
// from a single host across every deploy mode.
const HOST = 'app.inspectorhub.io';

describe('AgentInspectorsPage — A2', () => {
    it('renders one card per linked inspector with photo + name + booking link', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        expect(html).toContain('data-testid="inspector-card-mike"');
        expect(html).toContain('data-testid="inspector-card-bob"');
    });

    it('Copy button generates booking link with agent ref slug', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        expect(html).toContain('data-booking-url="https://app.inspectorhub.io/book/acme/mike?ref=jane"');
        expect(html).toContain('data-booking-url="https://app.inspectorhub.io/book/bobs/bob?ref=jane"');
    });

    it('omits ref query param when agent has no slug', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: null },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        expect(html).toContain('data-booking-url="https://app.inspectorhub.io/book/acme/mike"');
        expect(html).not.toContain('?ref=');
    });

    it('renders photo when provided', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        expect(html).toContain('https://r2/me.jpg');
    });

    it('falls back to initials placeholder when photo absent', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        // Bob's card has no photoUrl — render initials "B"
        expect(html).toMatch(/data-testid="inspector-card-bob"[\s\S]*?data-initials="B"/);
    });

    it('renders empty state when no inspectors are linked', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: [],
            host: HOST,
        }));
        expect(html).toContain('data-testid="agent-inspectors-empty"');
    });

    it('skips inspector with no slug (cannot generate booking link)', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: [{
                tenantId: 't3', tenantName: 'NoSlug', tenantSubdomain: 'noslug',
                contactId: null, inspectorName: 'Anon',
                inspectorPhotoUrl: null, inspectorSlug: null,
            }],
            host: HOST,
        }));
        expect(html).not.toContain('data-booking-url');
        expect(html).toContain('data-testid="inspector-card-no-slug"');
    });

    it('exposes Copy button per card with hover-expand URL preview affordance', () => {
        const html = render(AgentInspectorsPage({
            agent: { name: 'Jane', slug: 'jane' },
            inspectors: INSPECTORS,
            host: HOST,
        }));
        expect(html).toContain('data-testid="copy-booking-mike"');
        expect(html).toContain('data-testid="copy-booking-bob"');
    });
});
