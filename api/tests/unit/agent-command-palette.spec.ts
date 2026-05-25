import { describe, it, expect } from 'vitest';
import { AgentCommandPalette } from '../../src/templates/components/agent-command-palette';

function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('AgentCommandPalette — UC-A-6', () => {
    it('renders palette shell with Esc-to-close header + footer hotkey hint', () => {
        const html = render(AgentCommandPalette({
            inspectors: [],
            agentSlug: null,
            bookingHost: 'inspectorhub.io',
        }));
        expect(html).toContain('data-testid="agent-command-palette"');
        expect(html).toContain('Esc to close');
        expect(html).toContain('navigate');
        expect(html).toContain('toggle');
    });

    it('embeds Pages items (Dashboard / Inspectors / Settings) with G-then shortcuts', () => {
        const html = render(AgentCommandPalette({
            inspectors: [],
            agentSlug: null,
            bookingHost: 'inspectorhub.io',
        }));
        // Pages live inside the JSON-encoded x-data payload.
        expect(html).toContain('Dashboard');
        expect(html).toContain('Inspectors');
        expect(html).toContain('Settings');
        expect(html).toContain('G then D');
        expect(html).toContain('G then I');
        expect(html).toContain('G then S');
    });

    it('emits a "Sign out" action item', () => {
        const html = render(AgentCommandPalette({
            inspectors: [],
            agentSlug: null,
            bookingHost: 'inspectorhub.io',
        }));
        expect(html).toContain('Sign out');
        // The activate expression posts to /api/auth/logout.
        expect(html).toContain('/api/auth/logout');
    });

    it('emits one "Copy booking link — {name}" action per inspector with full booking URL', () => {
        const html = render(AgentCommandPalette({
            inspectors: [
                { name: 'Mike', slug: 'mike', tenantSubdomain: 'acme' },
                { name: 'Bob',  slug: 'bob',  tenantSubdomain: 'bobs' },
            ],
            agentSlug: 'jane',
            bookingHost: 'app.inspectorhub.io',
        }));
        // x-data payload is HTML-attribute-encoded — match either raw URL
        // string or its escaped form.
        expect(html).toContain('Copy booking link — Mike');
        expect(html).toContain('Copy booking link — Bob');
        expect(html).toContain('https://app.inspectorhub.io/book/acme/mike?ref=jane');
        expect(html).toContain('https://app.inspectorhub.io/book/bobs/bob?ref=jane');
    });

    it('skips inspectors with no slug (no copy action emitted)', () => {
        const html = render(AgentCommandPalette({
            inspectors: [
                { name: 'Mike',  slug: null, tenantSubdomain: 'acme' },
                { name: 'Bob',   slug: 'bob', tenantSubdomain: 'bobs' },
            ],
            agentSlug: 'jane',
            bookingHost: 'inspectorhub.io',
        }));
        expect(html).not.toContain('Copy booking link — Mike');
        expect(html).toContain('Copy booking link — Bob');
    });

    it('omits ?ref query when agentSlug is null', () => {
        const html = render(AgentCommandPalette({
            inspectors: [{ name: 'Mike', slug: 'mike', tenantSubdomain: 'acme' }],
            agentSlug: null,
            bookingHost: 'app.inspectorhub.io',
        }));
        expect(html).toContain('https://app.inspectorhub.io/book/acme/mike');
        expect(html).not.toMatch(/book\/acme\/mike\?ref=/);
    });

    it('opens via meta+k OR ctrl+/ keyboard shortcut', () => {
        const html = render(AgentCommandPalette({
            inspectors: [],
            agentSlug: null,
            bookingHost: 'inspectorhub.io',
        }));
        // Both keyboard combos are wired in the window keydown handler.
        // Single quotes are HTML-attribute-encoded to &#39;
        expect(html).toMatch(/k === &#39;k&#39;/);
        expect(html).toMatch(/k === &#39;\/&#39;/);
        expect(html).toMatch(/metaKey \|\| \$event\.ctrlKey/);
    });
});
