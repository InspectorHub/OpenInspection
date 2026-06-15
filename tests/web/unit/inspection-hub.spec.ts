import { describe, it, expect } from 'vitest';
import { deriveBlockStates, formatCents, canPublish, isReportShipped, type HubPayload } from '~/lib/hub-blocks';

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
            agreementRequests: [{ id: 'a', status: 'pending', clientEmail: 'c@x.com', signedAt: null, createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Awaiting signature' });
    });

    it('newest request sent → monitor / Awaiting signature', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [{ id: 'a', status: 'sent', clientEmail: 'c@x.com', signedAt: null, createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Awaiting signature' });
    });

    it('newest request viewed → monitor / Viewed', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [{ id: 'a', status: 'viewed', clientEmail: 'c@x.com', signedAt: null, createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'monitor', label: 'Viewed' });
    });

    it('newest request signed → sat / Signed', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [{ id: 'a', status: 'signed', clientEmail: 'c@x.com', signedAt: '2026-01-01', createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'sat', label: 'Signed' });
    });

    it('newest request declined → defect / Declined', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [{ id: 'a', status: 'declined', clientEmail: 'c@x.com', signedAt: null, createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'defect', label: 'Declined' });
    });

    it('newest request expired → warning / Expired', () => {
        const s = deriveBlockStates(hub({
            agreementRequests: [{ id: 'a', status: 'expired', clientEmail: 'c@x.com', signedAt: null, createdAt: null }],
        }));
        expect(s.agreement).toEqual({ tone: 'warning', label: 'Expired' });
    });

    it('uses the FIRST (newest) request when several exist', () => {
        // Payload is documented newest-first; derive must read index 0.
        const s = deriveBlockStates(hub({
            agreementRequests: [
                { id: 'new', status: 'signed', clientEmail: 'c@x.com', signedAt: '2026-02-01', createdAt: null },
                { id: 'old', status: 'declined', clientEmail: 'c@x.com', signedAt: null, createdAt: null },
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
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'draft', amountCents: 1000, sentAt: null, paidAt: null } }));
        expect(s.invoice).toEqual({ tone: 'neutral', label: 'Draft' });
    });

    it('sent invoice → monitor / Awaiting payment', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'sent', amountCents: 1000, sentAt: '2026-01-01', paidAt: null } }));
        expect(s.invoice).toEqual({ tone: 'monitor', label: 'Awaiting payment' });
    });

    it('partial invoice → warning / Partially paid', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'partial', amountCents: 1000, sentAt: '2026-01-01', paidAt: null } }));
        expect(s.invoice).toEqual({ tone: 'warning', label: 'Partially paid' });
    });

    it('paid invoice → sat / Paid', () => {
        const s = deriveBlockStates(hub({ invoice: { id: 'i', status: 'paid', amountCents: 1000, sentAt: '2026-01-01', paidAt: '2026-01-02' } }));
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

describe('canPublish — report publish affordance', () => {
    it('completed + in_progress → true (active publish CTA)', () => {
        expect(canPublish(hub({
            inspection: { status: 'completed', reportStatus: 'in_progress' },
        }))).toBe(true);
    });

    it('completed + submitted → true (can still publish bypassing review)', () => {
        expect(canPublish(hub({
            inspection: { status: 'completed', reportStatus: 'submitted' },
        }))).toBe(true);
    });

    it('completed + published → false (already published)', () => {
        expect(canPublish(hub({
            inspection: { status: 'completed', reportStatus: 'published' },
        }))).toBe(false);
    });

    it('requested + in_progress → false (status gate: not completed yet)', () => {
        expect(canPublish(hub({
            inspection: { status: 'requested', reportStatus: 'in_progress' },
        }))).toBe(false);
    });

    it('cancelled + in_progress → false (status gate excludes cancelled)', () => {
        expect(canPublish(hub({
            inspection: { status: 'cancelled', reportStatus: 'in_progress' },
        }))).toBe(false);
    });

    it('scheduled + in_progress → false (not completed)', () => {
        expect(canPublish(hub({
            inspection: { status: 'scheduled', reportStatus: 'in_progress' },
        }))).toBe(false);
    });
});

describe('isReportShipped', () => {
    it('published reportStatus → true', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'published' } }))).toBe(true);
    });

    it('in_progress reportStatus → false', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'in_progress' } }))).toBe(false);
    });

    it('submitted reportStatus → false', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'submitted' } }))).toBe(false);
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
