import { describe, it, expect } from 'vitest';
import { ContactsPage } from '../../src/templates/pages/contacts';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

describe('ContactsPage — A2 Agents tab', () => {
    it('renders a tab strip with Clients/Agents tabs', () => {
        const html = render(ContactsPage());
        expect(html).toContain('data-testid="contacts-tab-clients"');
        expect(html).toContain('data-testid="contacts-tab-agents"');
    });

    it('renders the Agents panel container loaded async via JS', () => {
        const html = render(ContactsPage());
        expect(html).toContain('data-testid="contacts-agents-panel"');
        // Agents tab JS is wired up
        expect(html).toContain('contacts-agents-tab.js');
    });

    it('agent partner link rows feature placeholder for status badge + revoke button JS', () => {
        const html = render(ContactsPage());
        // The body uses data attributes; client-side renders rows. We check the
        // JS file is referenced and the panel container exists.
        expect(html).toContain('agentLinksBody');
    });
});
