import { describe, it, expect } from 'vitest';
import { AgentSettingsProfilePage } from '../../src/templates/pages/agent-settings-profile';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

describe('AgentSettingsProfilePage — A2', () => {
    it('renders slug input + 3 notification toggle rows', () => {
        const html = render(AgentSettingsProfilePage({
            agent: {
                name: 'Jane', email: 'j@r.com', slug: 'jane',
                notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            },
        }));
        expect(html).toContain('data-testid="agent-slug-input"');
        expect(html).toContain('data-testid="agent-notify-referral"');
        expect(html).toContain('data-testid="agent-notify-report"');
        expect(html).toContain('data-testid="agent-notify-paid"');
    });

    it('renders booking-link preview when slug is set', () => {
        const html = render(AgentSettingsProfilePage({
            agent: {
                name: 'Jane', email: 'j@r.com', slug: 'jane',
                notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            },
        }));
        expect(html).toContain('data-testid="agent-slug-link"');
        expect(html).toContain('?ref=jane');
    });

    it('omits booking-link preview when slug is null', () => {
        const html = render(AgentSettingsProfilePage({
            agent: {
                name: 'Jane', email: 'j@r.com', slug: null,
                notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            },
        }));
        expect(html).not.toContain('data-testid="agent-slug-link"');
        expect(html).toContain('data-testid="agent-slug-empty-hint"');
    });

    it('toggles reflect current preference state via checked attribute', () => {
        const html = render(AgentSettingsProfilePage({
            agent: {
                name: 'Jane', email: 'j@r.com', slug: 'jane',
                notifyOnReferral: true, notifyOnReport: false, notifyOnPaid: true,
            },
        }));
        // notify-referral should be on -> data-active="true"
        const refMatch = html.match(/data-testid="agent-notify-referral"[\s\S]*?data-active="(true|false)"/);
        expect(refMatch?.[1]).toBe('true');
        const reportMatch = html.match(/data-testid="agent-notify-report"[\s\S]*?data-active="(true|false)"/);
        expect(reportMatch?.[1]).toBe('false');
        const paidMatch = html.match(/data-testid="agent-notify-paid"[\s\S]*?data-active="(true|false)"/);
        expect(paidMatch?.[1]).toBe('true');
    });

    it('exposes Save button on the slug card', () => {
        const html = render(AgentSettingsProfilePage({
            agent: {
                name: 'Jane', email: 'j@r.com', slug: 'jane',
                notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            },
        }));
        expect(html).toContain('data-testid="agent-slug-save"');
    });
});
