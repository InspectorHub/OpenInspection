import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../src/services/email.service';

describe('EmailService.sendEmail with attachments', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(''),
        });
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('forwards attachments array to Resend payload', async () => {
        const svc = new EmailService('re_test_key', 'noreply@test.com', 'TestApp');
        const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

        await svc.sendEmail(
            ['client@test.com'],
            'Report',
            '<p>Body</p>',
            [{ filename: 'report.pdf', content: pdfBytes }],
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
        expect(body.attachments).toBeDefined();
        expect(body.attachments).toHaveLength(1);
        expect(body.attachments[0].filename).toBe('report.pdf');
        // Resend expects base64-encoded `content` for binary attachments
        expect(typeof body.attachments[0].content).toBe('string');
        expect(body.attachments[0].content.length).toBeGreaterThan(0);
    });

    it('omits attachments key when none provided (back-compat)', async () => {
        const svc = new EmailService('re_test_key', 'noreply@test.com', 'TestApp');
        await svc.sendEmail(['a@b.com'], 'Subj', '<p>Body</p>');
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
        expect(body.attachments).toBeUndefined();
    });
});
