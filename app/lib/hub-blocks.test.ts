// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    isReportShipped,
    canPublish,
    latestPublishedAt,
    publishNotified,
    invoiceFromParty,
    type HubPayload,
} from '~/lib/hub-blocks';

function hub(overrides: {
    inspection?: Partial<HubPayload['inspection']>;
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
        agreementRequests: [],
        invoice: null,
        publishReadiness: overrides.publishReadiness ?? { ready: false, blockingCount: 0 },
    } as HubPayload;
}

describe('isReportShipped', () => {
    it('published → true', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'published' } }))).toBe(true);
    });
    it('in_progress → false', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'in_progress' } }))).toBe(false);
    });
    it('submitted → false', () => {
        expect(isReportShipped(hub({ inspection: { reportStatus: 'submitted' } }))).toBe(false);
    });
});

// canPublish reads the report axis and nothing else. The order lifecycle
// (requested → … → completed) tracks the job, not the report, and the server
// stopped gating publication on it — a UI gate here would only re-create the
// mismatch where the hub hides an action the API would have accepted.
describe('canPublish — report axis only', () => {
    it('allows publishing from every point in the order lifecycle', () => {
        for (const status of ['requested', 'scheduled', 'confirmed', 'completed', 'cancelled'] as const) {
            expect(canPublish(hub({ inspection: { status, reportStatus: 'in_progress' } }))).toBe(true);
        }
    });
    it('allows publishing a submitted report, bypassing review', () => {
        expect(canPublish(hub({ inspection: { status: 'confirmed', reportStatus: 'submitted' } }))).toBe(true);
    });
    it('does not offer publishing for an already published report', () => {
        expect(canPublish(hub({ inspection: { status: 'confirmed', reportStatus: 'published' } }))).toBe(false);
    });
});

/**
 * The Report card used to say "Report delivered to the client." whenever
 * `isReportShipped` was true — which is only `reportStatus === 'published'`.
 * Publishing takes `notifyClient` / `notifyAgent` checkboxes, so an inspector who
 * left both unticked published to nobody and was then told the client had it. The
 * card also offered a "Send report" button directly beneath that sentence, which
 * is the contradiction that gives the lie away.
 *
 * Publication time is a fact the hub does have — the report_versions rows carry
 * `publishedAt` — so the card can state that instead of inventing a delivery.
 */
describe('latestPublishedAt', () => {
    it('returns the newest publish instant, whatever order the versions arrive in', () => {
        expect(latestPublishedAt([
            { publishedAt: 1_700_000_000 },
            { publishedAt: 1_800_000_000 },
            { publishedAt: 1_750_000_000 },
        ])).toBe(1_800_000_000);
    });

    it('ignores versions with no recorded instant', () => {
        expect(latestPublishedAt([{ publishedAt: null }, { publishedAt: 1_700_000_000 }])).toBe(1_700_000_000);
    });

    it('is null when nothing has been published, so the copy omits the date rather than guessing one', () => {
        expect(latestPublishedAt([])).toBeNull();
        expect(latestPublishedAt([{ publishedAt: null }])).toBeNull();
    });
});

/**
 * What publishing actually notified. Read off the submitted form, because that is
 * the only place the answer exists — the hub payload records publication, not
 * delivery.
 */
describe('publishNotified', () => {
    it('names both recipients when both were ticked', () => {
        expect(publishNotified({ notifyClient: true, notifyAgent: true })).toBe('both');
    });

    it('names whichever single recipient was ticked', () => {
        expect(publishNotified({ notifyClient: true, notifyAgent: false })).toBe('client');
        expect(publishNotified({ notifyClient: false, notifyAgent: true })).toBe('agent');
    });

    it('says nobody when neither was ticked — the case the old copy misreported', () => {
        expect(publishNotified({ notifyClient: false, notifyAgent: false })).toBe('none');
    });

    it('treats an absent flag as unticked', () => {
        expect(publishNotified({})).toBe('none');
        expect(publishNotified({ notifyClient: undefined, notifyAgent: undefined })).toBe('none');
    });
});

/**
 * The invoice's FROM field showed "Your inspector" when the invoice carried no
 * inspector name. FROM on an invoice is the party owed money; a placeholder there
 * reads as a real answer and is not one. The company name is the correct
 * substitute, and an em dash — matching the sibling BILL TO field — is what is
 * left when neither exists.
 */
describe('invoiceFromParty', () => {
    it('prefers the inspector named on the invoice', () => {
        expect(invoiceFromParty('Dana Reyes', 'Reyes Home Inspection')).toBe('Dana Reyes');
    });

    it('falls back to the company, not to a placeholder', () => {
        expect(invoiceFromParty(null, 'Reyes Home Inspection')).toBe('Reyes Home Inspection');
        expect(invoiceFromParty('', 'Reyes Home Inspection')).toBe('Reyes Home Inspection');
        expect(invoiceFromParty('   ', 'Reyes Home Inspection')).toBe('Reyes Home Inspection');
    });

    it('shows an em dash when the document names nobody', () => {
        expect(invoiceFromParty(null, null)).toBe('—');
        expect(invoiceFromParty('', '')).toBe('—');
    });
});
