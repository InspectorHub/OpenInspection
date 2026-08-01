import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService } from '../../../server/services/email.service';

const STUB_INSPECTOR = {
    name: 'Mike Reynolds',
    email: 'mike@acme.test',
    phone: '(303) 555-0142',
    licenseNumber: 'TX-INSP-9001',
    slug: 'mike',
    tenantSlug: 'acme',
};

const HOST = 'app.inspectorhub.io';
// DB-12 / IA-26 — company-level URL; per-inspector slug retired.
const SIGNATURE_LINK = 'https://app.inspectorhub.io/book/acme';

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
        return { delivered: true };
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

/**
 * Credentials on the SEND path, not just in the preview.
 *
 * `inspectorSignature()` has rendered credential badges since Spec B and no
 * caller ever supplied any, so the feature was wired and dead: every recipient
 * got the legacy license line while Settings → Profile promised badges "shown on
 * your reports, emails, and booking page". The resolvers now populate them.
 *
 * THE ASSERTION THAT MATTERS IS THE ABSOLUTE URL. A spec that only checked
 * "credentials were passed" would pass while every recipient saw a broken
 * image: the stored `imageUrl` is root-relative (`/api/public/brand-asset?…`),
 * and a relative src inside an email resolves against the recipient's mail
 * client, which is nowhere.
 */
describe('EmailService — credential badges reach the recipient', () => {
    let svc: EmailService;
    let sent: SentCall[];

    const WITH_CREDENTIALS = {
        ...STUB_INSPECTOR,
        credentials: [
            { label: 'InterNACHI Certified', memberNumber: 'NACHI-22', imageUrl: '/api/public/brand-asset?key=t1%2Fcred%2Flogo.png' },
            { label: 'Licensed home inspector', memberNumber: 'TX-9001', imageUrl: null },
        ],
    };

    beforeEach(() => {
        const fixture = makeService();
        svc = fixture.svc;
        sent = fixture.sent;
    });

    it('renders the badge image as an ABSOLUTE url against the deployment host', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc', WITH_CREDENTIALS, HOST);
        const html = sent[0]?.html ?? '';
        expect(html).toMatch(/<img[^>]+src="https:\/\/app\.inspectorhub\.io\/api\/public\/brand-asset/);
        // The negative half: no `src="/…"` anywhere in the signature, which is
        // what shipping the stored value verbatim would produce.
        expect(html).not.toMatch(/<img[^>]+src="\/api\/public/);
    });

    it('asks for the EMAIL badge variant, not the stored original', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc', WITH_CREDENTIALS, HOST);
        const html = sent[0]?.html ?? '';
        // Badges are stored at whatever was uploaded — up to 2 MB — and drawn
        // here at 28px. Without the variant the recipient downloads the whole
        // thing to render a chip the height of a line of text, on every open.
        // `&amp;`, not `&` — the whole src goes through escapeHtml, which is the
        // correct encoding for an attribute and what every mail client decodes.
        // Asserting the raw ampersand here would fail against correct output.
        expect(html).toContain('&amp;v=email');
        // PNG, because Outlook draws with Word's engine and shows a broken-image
        // box for WebP. The variant name is what carries that decision.
        expect(html).toMatch(/<img[^>]+src="https:\/\/app\.inspectorhub\.io\/api\/public\/brand-asset[^"]*&amp;v=email"/);
    });

    it('renders a text-only credential too, so a blocked image never loses it', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc', WITH_CREDENTIALS, HOST);
        const html = sent[0]?.html ?? '';
        // Mail clients block remote images by default. A credential that exists
        // only as an <img> is a credential most recipients never see.
        expect(html).toContain('InterNACHI Certified #NACHI-22');
        expect(html).toContain('Licensed home inspector #TX-9001');
    });

    it('still sends a clean signature for an inspector with no credentials', async () => {
        await svc.sendReportReady('client@example.com', '1 Main St', 'https://r.example/abc',
            { ...STUB_INSPECTOR, credentials: [] }, HOST);
        const html = sent[0]?.html ?? '';
        expect(html).toContain('Mike Reynolds');
        expect(html).not.toContain('<img');
    });
});
