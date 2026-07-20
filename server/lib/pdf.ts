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
import { extractAnchorPages } from './toc-pages';
import { logger } from './logger';

/**
 * Bump when the report render template/CSS changes so content-hashed PDFs
 * re-render (e.g. eager images, photo resize, layout changes).
 * 'r3' — settings-driven running header/footer (page numbers + address +
 * license) via the CF /pdf quick action's pdfOptions; Letter format.
 * 'r4' — hide interactive controls (filter chips, Add-to-repair, repair panel)
 * from the print/PDF render.
 * 'r5' — Commercial PCA Phase P: 'appendix' photoMode suppresses inline
 * item/defect photo grids and renders a single end-of-report Appendix B
 * instead (template output structurally differs from 'inline').
 * 'r7' — Commercial PCA Task 19a: real two-pass TOC page numbers
 * (`generatePdfWithTocPages`). Replaces the r6 gated-Paged.js `target-counter`
 * path (removed — it only worked against a synthetic fixture, never a real
 * CF render). Pass 1 renders once; `extractAnchorPages` reads the named PDF
 * destinations Chrome emits for each `<a href="#id">` TOC link back to their
 * resolved 1-based page numbers; pass 2 re-renders with `?tocpages=<map>` so
 * `<ReportToc>` fills the reserved page-ref column with real numbers. Bumped
 * so previously content-hashed PDFs (rendered under the old gated path)
 * re-render under the new mechanism.
 */
export const RENDER_VERSION = 'r10';

/**
 * Backoff before the single pass-2 retry when Browser Rendering rate-limits the
 * back-to-back second render (HTTP 429). The Workers **Free** plan allows only
 * "1 Quick Action every 10 seconds"
 * (https://developers.cloudflare.com/browser-run/limits/), so pass 2 — fired
 * right after pass 1 — is rejected until the 10-second window clears. 11s (10s
 * window + 1s margin) reliably clears it; this is worker wall-time only and does
 * NOT consume browser-hours. Paid plans (10 Quick Actions/second) never hit this
 * path — pass 2 succeeds immediately with no wait.
 */
export const TOC_PASS2_RETRY_BACKOFF_MS = 11_000;

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

/**
 * Two-pass renderer for real TOC page numbers (Commercial PCA Task 19a).
 *
 * Pass 1 renders the report exactly like `generatePdfFromUrl`. Pass 2 only
 * happens when pass 1 actually contains named TOC destinations (residential/
 * no-tier reports have no TOC and never pay for a second Browser Rendering
 * call): `extractAnchorPages` reads back the page each `<a href="#id">` TOC
 * anchor landed on, and pass 2 re-renders the SAME url with `?tocpages=<map>`
 * appended so `<ReportToc>` fills the already-reserved page-ref column with
 * real numbers. Because the numbers land in a slot that was already reserved
 * (same width) during pass 1, pass 2's pagination is identical to pass 1's —
 * no iteration needed.
 */
export async function generatePdfWithTocPages(
    browser: BrowserRun | undefined,
    url: string,
    opts?: { title?: string; address?: string; license?: string | null; settings?: PdfSettings },
): Promise<ArrayBuffer> {
    const pass1 = await generatePdfFromUrl(browser, url, opts);

    let pageMap: Record<string, number>;
    try {
        pageMap = await extractAnchorPages(pass1);
    } catch (err) {
        // extractAnchorPages is defensive and shouldn't throw, but guard the
        // call site too — a failure to read pass 1 must never break the PDF
        // download, it should just skip page numbering.
        logger.warn('[pdf] extractAnchorPages failed, serving un-numbered TOC', {
            error: err instanceof Error ? err.message : String(err),
        });
        return pass1;
    }

    if (Object.keys(pageMap).length === 0) {
        // Nothing to number (no TOC in this report, or no anchor resolved) —
        // avoid a wasted second Browser Rendering pass.
        return pass1;
    }

    const tocParam = encodeURIComponent(btoa(JSON.stringify(pageMap)));
    const pass2Url = url.includes('?') ? `${url}&tocpages=${tocParam}` : `${url}?tocpages=${tocParam}`;

    // Pass 2 is a SECOND Browser Rendering call fired immediately after pass 1.
    // On free-tier Browser Rendering the back-to-back call is rate-limited (HTTP
    // 429, error code 2001) — pass 1 renders, then pass 2's quickAction is
    // rejected before it even loads the page. The TOC page numbers are an
    // enhancement, not a requirement, so a pass-2 failure MUST NOT break the
    // whole download (that would 500 every full-tier PCA PDF on free-tier BR —
    // see #240 follow-up). Retry once after a short backoff (the limit is a
    // short rolling window), then degrade to the un-numbered pass-1 PDF, exactly
    // like the extractAnchorPages catch above.
    try {
        return await generatePdfFromUrl(browser, pass2Url, opts);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('(429)')) {
            await new Promise((resolve) => setTimeout(resolve, TOC_PASS2_RETRY_BACKOFF_MS));
            try {
                return await generatePdfFromUrl(browser, pass2Url, opts);
            } catch (retryErr) {
                logger.warn('[pdf] pass-2 TOC render rate-limited after retry, serving un-numbered TOC', {
                    error: retryErr instanceof Error ? retryErr.message : String(retryErr),
                });
                return pass1;
            }
        }
        logger.warn('[pdf] pass-2 TOC render failed, serving un-numbered TOC', { error: message });
        return pass1;
    }
}
