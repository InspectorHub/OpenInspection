import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../../src/services/email.service';

interface AgentRecipient {
    id: string;
    email: string;
    name: string | null;
    notifyOnReferral: boolean;
    notifyOnReport: boolean;
    notifyOnPaid: boolean;
}

describe('EmailService — A2 agent notification preference gating', () => {
    let svc: EmailService;
    let sendEmailSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        svc = new EmailService('test-api-key', 'noreply@test.com', 'OpenInspection');
        sendEmailSpy = vi.fn().mockResolvedValue(undefined);
        // Replace the underlying sendEmail with a spy so we can assert on
        // delivery attempts without hitting Resend.
        (svc as unknown as { sendEmail: typeof sendEmailSpy }).sendEmail = sendEmailSpy;
    });

    function agent(overrides: Partial<AgentRecipient> = {}): AgentRecipient {
        return {
            id: 'a1',
            email: 'jane@realty.com',
            name: 'Jane',
            notifyOnReferral: true,
            notifyOnReport: true,
            notifyOnPaid: false,
            ...overrides,
        };
    }

    describe('sendNewReferral', () => {
        it('sends when notifyOnReferral is true', async () => {
            await svc.sendNewReferral(agent({ notifyOnReferral: true }), {
                propertyAddress: '1 Main', clientName: 'Sarah', dashboardUrl: 'https://example.com/agent-dashboard',
            });
            expect(sendEmailSpy).toHaveBeenCalledTimes(1);
            const args = sendEmailSpy.mock.calls[0]!;
            expect(args[0]).toEqual(['jane@realty.com']);
            expect(args[1]).toMatch(/referral|1 Main/i);
        });

        it('skips send when notifyOnReferral is false', async () => {
            await svc.sendNewReferral(agent({ notifyOnReferral: false }), {
                propertyAddress: '1 Main', clientName: 'Sarah', dashboardUrl: 'https://example.com/agent-dashboard',
            });
            expect(sendEmailSpy).not.toHaveBeenCalled();
        });
    });

    describe('sendAgentReportReady', () => {
        it('sends when notifyOnReport is true', async () => {
            await svc.sendAgentReportReady(agent({ notifyOnReport: true }), {
                propertyAddress: '1 Main', reportUrl: 'https://example.com/report/i-1?view=agent',
            });
            expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        });

        it('skips send when notifyOnReport is false', async () => {
            await svc.sendAgentReportReady(agent({ notifyOnReport: false }), {
                propertyAddress: '1 Main', reportUrl: 'https://example.com/report/i-1?view=agent',
            });
            expect(sendEmailSpy).not.toHaveBeenCalled();
        });
    });

    describe('sendInvoicePaid', () => {
        it('sends when notifyOnPaid is true', async () => {
            await svc.sendInvoicePaid(agent({ notifyOnPaid: true }), {
                propertyAddress: '1 Main', amountCents: 47500,
            });
            expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        });

        it('skips send when notifyOnPaid is false (default)', async () => {
            await svc.sendInvoicePaid(agent({ notifyOnPaid: false }), {
                propertyAddress: '1 Main', amountCents: 47500,
            });
            expect(sendEmailSpy).not.toHaveBeenCalled();
        });
    });
});
