import { describe, it, expect } from 'vitest';
// canPublish / isReportShipped are covered in hub-blocks.test.ts — one home per rule.
import { deriveBlockStates, formatCents, remainingCents, type HubPayload } from '~/lib/hub-blocks';

/**
 * Issue #111 — pure block-state derivation for the `/inspections/:id` hub page.
 *
 * `deriveBlockStates(hub)` collapses the aggregate payload into the three
 * status pills the page renders (agreement / invoice / report). Keeping it pure
 * lets us exhaustively assert every status branch without React or a loader.
 *
 * A minimal payload factory keeps each case readable: tests override only the
 * fields the branch under test cares about.
 */
function hub(overrides: {
    inspection?: Partial<HubPayload['inspection']>;
    agreementRequests?: HubPayload['agreementRequests'];
    invoice?: HubPayload['invoice'];
    publishReadiness?: HubPayload['publishReadiness'];
} = {}): HubPayload {
    return {
        inspection: {
            status: 'requested',
            reportStatus: 'in_progress',
            paymentRequired: false,
            agreementRequired: false,
            ...overrides.inspection,
        },
        agreementRequests: overrides.agreementRequests ?? [],
        invoice: overrides.invoice ?? null,
        publishReadiness: overrides.publishReadiness ?? { ready: false, blockingCount: 0 },
    } as HubPayload;
}

type AgreementRequest = HubPayload['agreementRequests'][number];

/**
 * One agreement request. Only `status` (and, for the signed cases, `signedAt`)
 * changes between the branches below; everything else is scenery that
 * `deriveBlockStates` does not read.
 */
function request(over: Partial<AgreementRequest> & Pick<AgreementRequest, 'status'>): AgreementRequest {
    return {
        id: 'a',
        clientEmail: 'c@x.com',
        signedAt: null,
        createdAt: null,
        agreementName: 'Standard Inspection Agreement',
        signersTotal: 1,
        signersSigned: 0,
        ...over,
    };
}

describe('deriveBlockStates — agreement block', () => {
    it('no requests & not required → neutral / Not required', () => {
        const s = deriveBlockStates(hub({ inspection: { agreementRequired: false } }));
        expect(s.agreement).toEqual({ tone: 'neutral', label: 'Not required' });
    });

    it('no requests & required → warning / Not sent', () => {
        const s = deriveBlockStates(hub({ inspection: { agreementRequired: true } }));
        expect(s.agreement).toEqual({ tone: 'warning', label: 'Not sent' });
    });

    it('newest request pending → monitor / Awaiting signature', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'pending' })],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Awaiting signature' });
    });

    it('newest request sent → monitor / Awaiting signature', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'sent' })],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Awaiting signature' });
    });

    it('newest request viewed → monitor / Viewed', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'viewed' })],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Viewed' });
    });

    it('newest request signed → sat / Signed', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'signed', signedAt: '2026-01-01', signersSigned: 1 })],
        }));
        expect(s.agreement).toEqual({ tone: 'sat', label: 'Signed' });
    });

    it('newest request declined → defect / Declined', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'declined' })],
        }));
        expect(s.agreement).toEqual({ tone: 'defect', label: 'Declined' });
    });

    it('newest request expired → warning / Expired', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [request({ status: 'expired' })],
        }));
        expect(s.agreement).toEqual({ tone: 'warning', label: 'Expired' });
    });

    it('uses the FIRST (newest) request when several exist', () => {
        // Payload is documented newest-first; derive must read index 0.
        const s = deriveBlockStates(hub({
            agreementRequests: [
                request({ id: 'new', status: 'signed', signedAt: '2026-02-01', signersSigned: 1 }),
                request({ id: 'old', status: 'declined' }),
            ],
        }));
        expect(s.agreement).toEqual({ tone: 'sat', label: 'Signed' });
    });
});

describe('deriveBlockStates — invoice block', () => {
    it('null & not payment-required → neutral / No invoice', () => {
        const s = deriveBlockStates(hub({ invoice: null, inspection: { paymentRequired: false } }));
        expect(s.invoice).toEqual({ tone: 'neutral', label: 'No invoice' });
    });

    it('null & payment-required → warning / Not invoiced', () => {
        const s = deriveBlockStates(hub({ invoice: null, inspection: { paymentRequired: true } }));
        expect(s.invoice).toEqual({ tone: 'warning', label: 'Not invoiced' });
    });

    it('draft invoice → neutral / Draft', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'draft', amountCents: 1000, sentAt: null, paidAt: null, payUrl: null } }));
        expect(s.invoice).toEqual({ tone: 'neutral', label: 'Draft' });
    });

    it('sent invoice → monitor / Awaiting payment', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'sent', amountCents: 1000, sentAt: '2026-01-01', paidAt: null, payUrl: null } }));
        expect(s.invoice).toEqual({ tone: 'monitor', label: 'Awaiting payment' });
    });

    /**
     * A partial invoice's whole point is the number: "Partially paid" without a
     * figure tells an inspector nothing they could act on, and tells a client
     * nothing about what they still owe. These four cases pin the only four
     * things the card is allowed to say.
     */
    const partial = (over: Record<string, unknown>) =>
        deriveBlockStates(hub({
            invoice: {
                id: 'i', status: 'partial', amountCents: 45000, sentAt: '2026-01-01',
                paidAt: null, payUrl: null, ...over,
            } as HubPayload['invoice'],
        })).invoice;

    it('shows the outstanding balance on a partially paid invoice', () => {
        const s = partial({ amountPaidCents: 25000 });
        expect(s.tone).toBe('warning');
        expect(s.label).toBe('Partially paid');
        expect(s.detail).toContain('$200.00');
    });

    it('formats the balance in the invoice’s own currency, not the viewer’s default', () => {
        const s = partial({ amountPaidCents: 25000, currency: 'EUR' });
        expect(s.detail).toContain('€200.00');
        expect(s.detail).not.toContain('$');
    });

    it('does not claim a balance when the amount paid is unknown', () => {
        // Rows written before the column shipped carry partial_paid_at and no
        // amount. Saying "$0.00 remaining" about them would be a false statement
        // about money, so the card names the gap instead of inventing a figure.
        const s = partial({ amountPaidCents: null });
        expect(s.detail).not.toMatch(/\$/);
        expect(s.detail).toBe('Amount received not recorded');
    });

    it('says nothing about the balance when money is redacted for this viewer', () => {
        // IA-95 — no `financial` capability, so `amountCents` never arrived. The
        // balance is not unknown to the business, only to this reader; claiming
        // "not recorded" would be the wrong statement.
        const s = partial({ amountCents: undefined, amountPaidCents: 25000 });
        expect(s).toEqual({ tone: 'warning', label: 'Partially paid' });
    });

    it('never shows a negative balance when more was received than we billed', () => {
        // Divergent edits on either side can leave the received figure above our
        // total. A negative "remaining" reads as a refund we are not promising.
        expect(remainingCents({ amountCents: 45000, amountPaidCents: 60000 })).toBe(0);
    });

    it('paid invoice → sat / Paid', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'paid', amountCents: 1000, sentAt: '2026-01-01', paidAt: '2026-01-02', payUrl: null } }));
        expect(s.invoice).toEqual({ tone: 'sat', label: 'Paid' });
    });
});

describe('deriveBlockStates — report block (reportStatus axis)', () => {
    it('in_progress reportStatus → neutral / In Progress', () => {
        const s = deriveBlockStates(hub({ inspection: { reportStatus: 'in_progress' } }));
        expect(s.report).toEqual({ tone: 'neutral', label: 'In Progress' });
    });

    it('submitted reportStatus → warning / Submitted', () => {
        const s = deriveBlockStates(hub({ inspection: { reportStatus: 'submitted' } }));
        expect(s.report).toEqual({ tone: 'warning', label: 'Submitted' });
    });

    it('published reportStatus → sat / Published', () => {
        const s = deriveBlockStates(hub({ inspection: { reportStatus: 'published' } }));
        expect(s.report).toEqual({ tone: 'sat', label: 'Published' });
    });

    it('unknown reportStatus → neutral / In Progress (safe default)', () => {
        const s = deriveBlockStates(hub({ inspection: { reportStatus: 'unknown_value' } }));
        expect(s.report).toEqual({ tone: 'neutral', label: 'In Progress' });
    });
});

describe('formatCents', () => {
    it('formats whole dollars with the currency symbol', () => {
        expect(formatCents(50000)).toBe('$500.00');
    });

    it('formats sub-dollar amounts', () => {
        expect(formatCents(99)).toBe('$0.99');
    });

    it('formats zero', () => {
        expect(formatCents(0)).toBe('$0.00');
    });

    it('groups thousands', () => {
        expect(formatCents(123456)).toBe('$1,234.56');
    });

    it('treats null/undefined as zero', () => {
        expect(formatCents(null)).toBe('$0.00');
        expect(formatCents(undefined)).toBe('$0.00');
    });
});
