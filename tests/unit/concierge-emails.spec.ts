import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../../server/services/email.service';

/**
 * Agent Accounts A3 — Resend templates for the concierge state machine.
 *
 * Verifies:
 *   1. sendConciergeClientConfirm   (sent on awaiting_client; magic-link CTA)
 *   2. sendConciergeInspectorReview (sent on awaiting_inspector; review CTA)
 *   3. sendConciergeConfirmedToAgent (sent when client confirms)
 *   4. sendConciergeCancelledToAgent (sent when inspector cancels)
 *
 * Each test stubs `fetch` so we can read what would have gone to the Resend
 * API and assert subject + recipient + key body strings.
 */
describe('EmailService — concierge templates (A3)', () => {
    let svc: EmailService;
    let captured: { url?: string; body?: any };

    beforeEach(() => {
        svc = new EmailService('re_FAKE_KEY_test', 'noreply@example.com', 'OpenInspection');
        captured = {};
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
            captured.url = String(url);
            captured.body = JSON.parse(init.body);
            return new Response(JSON.stringify({ id: 'mock' }), { status: 200 });
        });
    });

    it('sendConciergeClientConfirm posts to Resend with the confirm URL', async () => {
        await svc.sendConciergeClientConfirm('sarah@example.com', {
            token: 'tok-abc',
            confirmUrl: 'https://acme.example.com/confirm/tok-abc',
            propertyAddress: '1 Main St',
            date: '2026-06-15',
            inspectorName: 'Mike Reynolds',
        });
        expect(captured.url).toContain('api.resend.com');
        expect(captured.body.to).toEqual(['sarah@example.com']);
        expect(captured.body.subject).toMatch(/Confirm.*1 Main St/i);
        expect(captured.body.html).toContain('https://acme.example.com/confirm/tok-abc');
        expect(captured.body.html).toContain('Mike Reynolds');
        expect(captured.body.html).toContain('1 Main St');
        expect(captured.body.html).toContain('2026-06-15');
    });

    it('sendConciergeInspectorReview posts to Resend with reviewer subject + dashboard CTA', async () => {
        await svc.sendConciergeInspectorReview('mike@acme.com', {
            inspectionId: 'insp-1',
            clientName: 'Sarah Buyer',
            propertyAddress: '1 Main St',
            date: '2026-06-15',
            reviewUrl: 'https://acme.example.com/dashboard',
        });
        expect(captured.body.to).toEqual(['mike@acme.com']);
        expect(captured.body.subject).toMatch(/awaiting your review/i);
        expect(captured.body.html).toContain('Sarah Buyer');
        expect(captured.body.html).toContain('https://acme.example.com/dashboard');
    });

    it('sendConciergeConfirmedToAgent posts a confirmation summary', async () => {
        await svc.sendConciergeConfirmedToAgent('jane@realty.com', {
            propertyAddress: '1 Main St',
            date: '2026-06-15',
            clientName: 'Sarah Buyer',
        });
        expect(captured.body.to).toEqual(['jane@realty.com']);
        expect(captured.body.subject).toMatch(/confirmed/i);
        expect(captured.body.html).toContain('Sarah Buyer');
        expect(captured.body.html).toContain('1 Main St');
    });

    it('sendConciergeCancelledToAgent renders the optional reason when provided', async () => {
        await svc.sendConciergeCancelledToAgent('jane@realty.com', {
            propertyAddress: '1 Main St',
            date: '2026-06-15',
            reason: 'Inspector unavailable',
        });
        expect(captured.body.subject).toMatch(/cancelled/i);
        expect(captured.body.html).toContain('Inspector unavailable');
    });

    it('sendConciergeCancelledToAgent omits the reason block when not provided', async () => {
        await svc.sendConciergeCancelledToAgent('jane@realty.com', {
            propertyAddress: '1 Main St',
            date: '2026-06-15',
        });
        // The static "Reason: " label only appears when caller passes a reason.
        expect(captured.body.html).not.toContain('Reason:');
    });

    it('escapes HTML metacharacters in user-supplied text to avoid injection', async () => {
        await svc.sendConciergeClientConfirm('sarah@example.com', {
            token: 'tok-abc',
            confirmUrl: 'https://example/confirm/tok-abc',
            propertyAddress: '<script>alert(1)</script>',
            date: '2026-06-15',
            inspectorName: 'Mike',
        });
        expect(captured.body.html).not.toContain('<script>alert(1)</script>');
        expect(captured.body.html).toContain('&lt;script&gt;');
    });
});
