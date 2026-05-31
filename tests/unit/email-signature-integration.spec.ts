import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService } from '../../src/services/email.service';

const STUB_INSPECTOR = {
    name: 'Mike Reynolds',
    email: 'mike@acme.test',
    phone: '(303) 555-0142',
    licenseNumber: 'TX-INSP-9001',
    slug: 'mike',
    tenantSubdomain: 'acme',
};

const HOST = 'app.inspectorhub.io';
const SIGNATURE_LINK = 'https://app.inspectorhub.io/book/acme/mike';

interface SentCall {
    to: string[];
    subject: string;
    html: string;
}

function makeService(): { svc: EmailService; sent: SentCall[] } {
    const svc = new EmailService('test_api_key', 'no-reply@acme.test', 'Acme');
    const sent: SentCall[] = [];
    // Spy on the internal sendEmail to capture the composed body before
    // Resend is called. We pass an obviously-fake API key into the
    // constructor, but to short-circuit Resend we also override sendEmail.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).sendEmail = vi.fn(async (to: string[], subject: string, html: string) => {
        sent.push({ to, subject, html });
    });
    return { svc, sent };
}

describe('EmailService — signature footer (Sprint B-4a + B-4c)', () => {
    let svc: EmailService;
    let sent: SentCall[];

    beforeEach(() => {
        const fixture = makeService();
        svc = fixture.svc;
        sent = fixture.sent;
    });

    it('appends the signature block to Booking Confirmation HTML body', async () => {
        await svc.sendBookingConfirmation(
            'client@example.com',
            'Jane',
            '1 Main St',
            '2026-06-01',
            'Morning (8:00 AM – 12:00 PM)',
            undefined,
            STUB_INSPECTOR,
            HOST,
        );
        expect(sent).toHaveLength(1);
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('appends signature to Report Ready', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc', STUB_INSPECTOR, HOST);
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('appends signature to Report PDF email', async () => {
        const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
        await svc.sendInspectionReportPdf('client@example.com', '1 Main St', 'https://r.example/abc', pdf, STUB_INSPECTOR, HOST);
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('appends signature to Agreement Request', async () => {
        await svc.sendAgreementRequest('client@example.com', 'Jane', 'Inspection Agreement', 'https://sign.example', STUB_INSPECTOR, HOST);
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('appends signature to Agreement Signed Confirmation (B-4c)', async () => {
        await svc.sendAgreementSignedConfirmation(
            'client@example.com',
            ['inspector@acme.test'],
            'Jane',
            '1 Main St',
            'https://verify.example',
            'CONF-123',
            '2026-05-09T12:00:00Z',
            '127.0.0.1',
            STUB_INSPECTOR,
            HOST,
        );
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('appends signature to Agent Share Link (B-4c)', async () => {
        await svc.sendAgentShareLink('agent@example.com', '1 Main St', 'https://r.example/agent', STUB_INSPECTOR, HOST);
        expect(sent[0]?.html).toContain('Mike Reynolds');
        expect(sent[0]?.html).toContain(SIGNATURE_LINK);
    });

    it('omits signature gracefully when inspector is undefined (legacy callers)', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc');
        expect(sent[0]?.html).not.toContain('Mike Reynolds');
        expect(sent[0]?.html).not.toContain('/book/');
    });
});
