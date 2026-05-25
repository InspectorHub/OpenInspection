import { describe, it, expect } from 'vitest';
import { ReportGatePage } from '../../src/templates/pages/report-gate';

/**
 * BUG #22 — pin the redesigned ReportGatePage contract:
 *   * inspector contact rows render when the data is available, honoring
 *     the body promise that "your inspector's contact details are listed
 *     below"
 *   * payment-reason CTA carries the dollar amount so the customer sees
 *     what they're agreeing to before clicking
 *   * agreement-reason CTA falls through to the explicit actionLabel
 *   * trust badge says "Secured by Stripe" only when the gate is for a
 *     payment, not for a pending agreement
 */

function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

const baseProps = {
    companyName:  'Acme Inspections',
    primaryColor: '#6366f1',
    actionUrl:    'https://example.com/r/abc/invoice',
    actionLabel:  'View invoice & pay',
};

describe('ReportGatePage — payment reason', () => {
    it('renders contact rows when inspector email / phone / license are available', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            reason:            'payment',
            inspectorName:     'Mike Reynolds',
            inspectorEmail:    'mike@acme.test',
            inspectorPhone:    '512-555-0123',
            inspectorLicense:  'TX-INSP-9001',
            propertyAddress:   '555 Test Drive',
            scheduledDate:     '2026-05-16',
            amountCents:       47500,
            currency:          'USD',
        }));
        expect(html).toContain('mailto:mike@acme.test');
        expect(html).toContain('tel:512-555-0123');
        expect(html).toContain('TX-INSP-9001');
        expect(html).toContain('555 Test Drive');
    });

    it('puts the dollar amount on the CTA when amountCents is set', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            reason:      'payment',
            amountCents: 47500,
            currency:    'USD',
        }));
        expect(html).toMatch(/Pay \$475 now/);
        // The default actionLabel must NOT also leak into the rendered button
        // — the amount label replaces it for payment gates.
        expect(html).not.toMatch(/>View invoice & pay</);
    });

    it('falls back to the actionLabel CTA when no amount is available', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            reason: 'payment',
        }));
        expect(html).toContain('View invoice &amp; pay');
        expect(html).not.toMatch(/Pay \$/);
    });

    it('renders the Stripe trust badge for payment gates', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            reason:      'payment',
            amountCents: 10000,
        }));
        expect(html).toContain('Secured by Stripe');
    });
});

describe('ReportGatePage — agreement reason', () => {
    it('keeps the explicit action label and skips the Stripe badge', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            actionLabel: 'Sign agreement',
            reason:      'agreement',
        }));
        expect(html).toContain('Sign agreement');
        expect(html).not.toContain('Secured by Stripe');
        expect(html).not.toMatch(/Pay \$/);
    });

    it('still renders contact rows when inspector data is available', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            actionLabel:    'Sign agreement',
            reason:         'agreement',
            inspectorEmail: 'mike@acme.test',
        }));
        expect(html).toContain('mailto:mike@acme.test');
    });
});

describe('ReportGatePage — meta card omitted when nothing to show', () => {
    it('does not render the meta block when no row data is provided', () => {
        const html = render(ReportGatePage({
            ...baseProps,
            reason: 'agreement',
        }));
        expect(html).not.toContain('class="meta"');
    });
});
