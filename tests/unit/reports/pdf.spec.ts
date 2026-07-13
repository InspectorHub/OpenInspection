import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePdfFromUrl, generatePdfWithTocPages, TOC_PASS2_RETRY_BACKOFF_MS } from '../../../server/lib/pdf';
import type { BrowserRun } from '../../../server/types/hono';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same fixture as tests/unit/reports/toc-pages.spec.ts — a real Chrome-rendered
// PDF whose TOC anchors resolve to named destinations.
const TOC_FIXTURE = readFileSync(join(__dirname, '../../fixtures/toc-fixture.pdf'));

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

describe('generatePdfWithTocPages', () => {
    it('renders twice and appends ?tocpages=<base64url map> to the second pass when pass 1 has a TOC', async () => {
        const browser = {
            quickAction: vi.fn()
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(TOC_FIXTURE.buffer.slice(TOC_FIXTURE.byteOffset, TOC_FIXTURE.byteOffset + TOC_FIXTURE.byteLength)) })
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }),
        };
        const result = await generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc');

        expect(browser.quickAction).toHaveBeenCalledTimes(2);
        expect(result).toBeInstanceOf(ArrayBuffer);

        const [, pass2Opts] = browser.quickAction.mock.calls[1];
        const pass2Url: string = pass2Opts.url;
        expect(pass2Url).toMatch(/[?&]tocpages=/);
        const tocParam = new URL(pass2Url).searchParams.get('tocpages');
        expect(tocParam).toBeTruthy();
        const decoded = JSON.parse(atob(decodeURIComponent(tocParam as string)));
        expect(decoded).toEqual({ roof: 3, structural: 5, mechanical: 7, electrical: 9, plumbing: 11 });
    });

    it('skips the second pass and returns pass 1 unchanged when there is no TOC', async () => {
        const fakePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF" magic, no named dests
        const browser = {
            quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(fakePdfBytes) }),
        };
        const result = await generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc');

        expect(browser.quickAction).toHaveBeenCalledTimes(1);
        expect(result).toBe(fakePdfBytes);
    });

    it('preserves footer/settings opts across both passes', async () => {
        const browser = {
            quickAction: vi.fn()
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(TOC_FIXTURE.buffer.slice(TOC_FIXTURE.byteOffset, TOC_FIXTURE.byteOffset + TOC_FIXTURE.byteLength)) })
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }),
        };
        await generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc', {
            address: '123 Main St',
            settings: { showFooter: true, showPageNumbers: true, showLicense: true, companyAddress: null },
        });
        const [, pass1Opts] = browser.quickAction.mock.calls[0];
        const [, pass2Opts] = browser.quickAction.mock.calls[1];
        expect(pass1Opts.pdfOptions.footerTemplate).toContain('123 Main St');
        expect(pass2Opts.pdfOptions.footerTemplate).toContain('123 Main St');
    });

    // Same fixture helper the passing tests use — a real Chrome-rendered PDF
    // whose TOC anchors resolve to named destinations (so pass 2 is attempted).
    const fixtureBuffer = () =>
        TOC_FIXTURE.buffer.slice(TOC_FIXTURE.byteOffset, TOC_FIXTURE.byteOffset + TOC_FIXTURE.byteLength);

    it('retries pass 2 once after the backoff when Browser Rendering returns 429, then serves the numbered PDF', async () => {
        vi.useFakeTimers();
        try {
            const numbered = new ArrayBuffer(8);
            const browser = {
                quickAction: vi.fn()
                    .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(fixtureBuffer()) })   // pass 1
                    .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve('{"errors":[{"code":2001,"message":"Rate limit exceeded"}]}') }) // pass 2 (rate-limited)
                    .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(numbered) }),          // pass 2 retry
            };
            const promise = generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc');
            await vi.advanceTimersByTimeAsync(TOC_PASS2_RETRY_BACKOFF_MS);
            const result = await promise;

            expect(browser.quickAction).toHaveBeenCalledTimes(3);
            expect(result).toBe(numbered);
        } finally {
            vi.useRealTimers();
        }
    });

    it('degrades to the un-numbered pass-1 PDF when pass 2 is still rate-limited after the retry', async () => {
        vi.useFakeTimers();
        try {
            const pass1Bytes = fixtureBuffer();
            const browser = {
                quickAction: vi.fn()
                    .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(pass1Bytes) })         // pass 1
                    .mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('Rate limit exceeded') }), // pass 2 + retry both 429
            };
            const promise = generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc');
            await vi.advanceTimersByTimeAsync(TOC_PASS2_RETRY_BACKOFF_MS);
            const result = await promise;

            expect(browser.quickAction).toHaveBeenCalledTimes(3);   // pass 1 + pass 2 + one retry
            expect(result).toBe(pass1Bytes);                        // never throws — un-numbered PDF still downloads
        } finally {
            vi.useRealTimers();
        }
    });

    it('degrades to the un-numbered pass-1 PDF (no retry) when pass 2 fails with a non-429 error', async () => {
        const pass1Bytes = fixtureBuffer();
        const browser = {
            quickAction: vi.fn()
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(pass1Bytes) })             // pass 1
                .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('quota exceeded') }), // pass 2 non-429
        };
        const result = await generatePdfWithTocPages(browser as unknown as BrowserRun, 'https://example.com/report/abc');

        expect(browser.quickAction).toHaveBeenCalledTimes(2);       // no retry on non-429
        expect(result).toBe(pass1Bytes);
    });
});
