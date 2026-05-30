/**
 * PDF generation helper for inspection reports.
 *
 * Calls Cloudflare Browser Run Quick Actions (env.BROWSER.quickAction("pdf"))
 * to fetch a public report URL and convert it to PDF. The binding is
 * OPTIONAL — callers MUST handle the thrown error and fall back to
 * text-only delivery (browser print on the client side stays available
 * either way).
 *
 * Free tier: 10 browser minutes/day. Worker `compatibility_date` must be
 * >= "2026-03-24" for the .quickAction() method to be available.
 */
import type { BrowserRun } from '../types/hono';

export async function generatePdfFromUrl(
    browser: BrowserRun | undefined,
    url: string,
): Promise<ArrayBuffer> {
    if (!browser) {
        throw new Error('PDF generation unavailable: BROWSER binding not configured');
    }

    // Append print-mode hint so the page can render slightly differently if
    // it wants to (currently the @media print stylesheet handles it).
    const renderUrl = url.includes('?') ? `${url}&print=1` : `${url}?print=1`;

    const res = await browser.quickAction('pdf', { url: renderUrl });
    if (!res.ok) {
        const detail = await res.text().catch(() => '<no body>');
        throw new Error(`PDF rendering failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return await res.arrayBuffer();
}
