import { describe, it, expect, vi } from 'vitest';
import { generatePdfFromUrl } from '../../server/lib/pdf';
import type { BrowserRun } from '../../server/types/hono';

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
