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
import type { PdfSettings } from './pdf-settings';

/**
 * Bump when the report render template/CSS changes so content-hashed PDFs
 * re-render (e.g. eager images, photo resize, layout changes).
 * 'r3' — settings-driven running header/footer (page numbers + address +
 * license) via the CF /pdf quick action's pdfOptions; Letter format.
 * 'r4' — hide interactive controls (filter chips, Add-to-repair, repair panel)
 * from the print/PDF render.
 */
export const RENDER_VERSION = 'r4';

export async function generatePdfFromUrl(
    browser: BrowserRun | undefined,
    url: string,
    opts?: { title?: string; address?: string; license?: string | null; settings?: PdfSettings },
): Promise<ArrayBuffer> {
    if (!browser) {
        throw new Error('PDF generation unavailable: BROWSER binding not configured');
    }

    // Append print-mode hint so the page can render slightly differently if
    // it wants to (currently the @media print stylesheet handles it).
    const renderUrl = url.includes('?') ? `${url}&print=1` : `${url}?print=1`;

    // Layer ③ — settings-driven running footer. Default ON; omitted entirely
    // when the tenant disables showFooter. Left = company/property address
    // [· Lic. <inspector license>], right = "Page X / Y".
    const s = opts?.settings;
    const showFooter = s?.showFooter !== false;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const left = esc(s?.companyAddress ?? opts?.address ?? '')
        + (s?.showLicense !== false && opts?.license ? ` &middot; Lic. ${esc(opts.license)}` : '');
    const pages = s?.showPageNumbers !== false
        ? `<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>`
        : '<span></span>';
    const footerTemplate = `<div style="font-size:8px;width:100%;padding:0 0.5in;display:flex;justify-content:space-between;color:#666;"><span>${left}</span>${pages}</div>`;

    // Wait for the network to go idle before capturing so full-resolution
    // report photos finish downloading — otherwise large images race the
    // capture and come out blank/broken in the PDF. gotoOptions is forwarded
    // to the headless page.goto(); a generous timeout guards slow R2/IMAGES.
    const res = await browser.quickAction('pdf', {
        url: renderUrl,
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
        pdfOptions: {
            format: 'letter',
            printBackground: true,
            displayHeaderFooter: showFooter,
            headerTemplate: '<div></div>',
            footerTemplate: showFooter ? footerTemplate : '<div></div>',
            margin: { top: '0.5in', bottom: showFooter ? '0.7in' : '0.5in', left: '0.5in', right: '0.5in' },
        },
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '<no body>');
        throw new Error(`PDF rendering failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return await res.arrayBuffer();
}
