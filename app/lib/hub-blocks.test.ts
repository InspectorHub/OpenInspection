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

describe('canPublish', () => {
    it('completed + in_progress → true', () => {
        expect(canPublish(hub({ inspection: { status: 'completed', reportStatus: 'in_progress' } }))).toBe(true);
    });
    it('completed + submitted → true (can still publish bypassing review)', () => {
        expect(canPublish(hub({ inspection: { status: 'completed', reportStatus: 'submitted' } }))).toBe(true);
    });
    it('completed + published → false (already published)', () => {
        expect(canPublish(hub({ inspection: { status: 'completed', reportStatus: 'published' } }))).toBe(false);
    });
    it('requested + in_progress → false (not completed)', () => {
        expect(canPublish(hub({ inspection: { status: 'requested', reportStatus: 'in_progress' } }))).toBe(false);
    });
    it('cancelled + in_progress → false (cancelled)', () => {
        expect(canPublish(hub({ inspection: { status: 'cancelled', reportStatus: 'in_progress' } }))).toBe(false);
    });
    it('scheduled + in_progress → false (not completed)', () => {
        expect(canPublish(hub({ inspection: { status: 'scheduled', reportStatus: 'in_progress' } }))).toBe(false);
    });
});
