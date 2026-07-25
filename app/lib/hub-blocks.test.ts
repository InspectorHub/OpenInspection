// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isReportShipped, canPublish, type HubPayload } from '~/lib/hub-blocks';

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
