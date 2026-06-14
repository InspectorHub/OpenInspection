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

/**
 * Bump when the report render template/CSS changes so content-hashed PDFs
 * re-render (e.g. eager images, photo resize, layout changes).
 * Start at 'r2' since the template just changed — eager images + photo resize.
 */
export const RENDER_VERSION = 'r2';

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

    // Wait for the network to go idle before capturing so full-resolution
    // report photos finish downloading — otherwise large images race the
    // capture and come out blank/broken in the PDF. gotoOptions is forwarded
    // to the headless page.goto(); a generous timeout guards slow R2/IMAGES.
    const res = await browser.quickAction('pdf', {
        url: renderUrl,
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '<no body>');
        throw new Error(`PDF rendering failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return await res.arrayBuffer();
}
