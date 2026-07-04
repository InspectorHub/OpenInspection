import { describe, it, expect, vi } from 'vitest';
import { generatePdfFromUrl } from '../../../server/lib/pdf';
import type { BrowserRun } from '../../../server/types/hono';

describe('generatePdfFromUrl', () => {
    it('returns ArrayBuffer when BROWSER binding renders successfully', async () => {
        const fakePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF" magic
        const browser = {
            quickAction: vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(fakePdfBytes),
            }),
        };
        const url = 'https://example.com/report/abc';

        const result = await generatePdfFromUrl(browser as unknown as BrowserRun, url);

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result.byteLength).toBe(4);
        // Browser Run Quick Actions API: quickAction('pdf', { url }) where the
        // url carries the print-mode hint (?print=1 / &print=1).
        expect(browser.quickAction).toHaveBeenCalledWith(
            'pdf',
            expect.objectContaining({ url: expect.stringMatching(/[?&]print=1\b/) }),
        );
    });

    it('builds a settings-driven footer (address + license + page numbers) on Letter', async () => {
        const browser = { quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) };
        await generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com/r', {
            address: '123 Main St',
            license: 'LIC-42',
            settings: { showFooter: true, showPageNumbers: true, showLicense: true, companyAddress: null },
        });
        const [, opts] = browser.quickAction.mock.calls[0];
        expect(opts.pdfOptions.format).toBe('letter');
        expect(opts.pdfOptions.displayHeaderFooter).toBe(true);
        expect(opts.pdfOptions.footerTemplate).toContain('123 Main St');
        expect(opts.pdfOptions.footerTemplate).toContain('Lic. LIC-42');
        expect(opts.pdfOptions.footerTemplate).toContain('pageNumber');
    });

    it('prefers companyAddress over property address and HTML-escapes it', async () => {
        const browser = { quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) };
        await generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com/r', {
            address: 'fallback addr',
            settings: { showFooter: true, showPageNumbers: true, showLicense: true, companyAddress: 'Acme & Co <HQ>' },
        });
        const [, opts] = browser.quickAction.mock.calls[0];
        expect(opts.pdfOptions.footerTemplate).toContain('Acme &amp; Co &lt;HQ&gt;');
        expect(opts.pdfOptions.footerTemplate).not.toContain('fallback addr');
    });

    it('omits footer entirely when showFooter is false', async () => {
        const browser = { quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) };
        await generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com/r', {
            address: '123 Main St',
            settings: { showFooter: false, showPageNumbers: true, showLicense: true, companyAddress: null },
        });
        const [, opts] = browser.quickAction.mock.calls[0];
        expect(opts.pdfOptions.displayHeaderFooter).toBe(false);
        expect(opts.pdfOptions.footerTemplate).toBe('<div></div>');
    });

    it('omits page numbers and license when those settings are off', async () => {
        const browser = { quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) };
        await generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com/r', {
            address: '123 Main St',
            license: 'LIC-42',
            settings: { showFooter: true, showPageNumbers: false, showLicense: false, companyAddress: null },
        });
        const [, opts] = browser.quickAction.mock.calls[0];
        expect(opts.pdfOptions.footerTemplate).not.toContain('pageNumber');
        expect(opts.pdfOptions.footerTemplate).not.toContain('Lic.');
    });

    it('defaults footer ON (Letter) when no settings/opts passed', async () => {
        const browser = { quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) };
        await generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com/r');
        const [, opts] = browser.quickAction.mock.calls[0];
        expect(opts.pdfOptions.format).toBe('letter');
        expect(opts.pdfOptions.displayHeaderFooter).toBe(true);
    });

    it('throws when BROWSER binding is undefined', async () => {
        await expect(generatePdfFromUrl(undefined, 'https://example.com')).rejects.toThrow(/binding not configured/i);
    });

    it('throws when BROWSER fetch returns non-ok response', async () => {
        const browser = {
            quickAction: vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('quota exceeded') }),
        };
        await expect(generatePdfFromUrl(browser as unknown as BrowserRun, 'https://example.com'))
            .rejects.toThrow(/PDF rendering failed/i);
    });
});
