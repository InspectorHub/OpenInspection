/**
 * PDF generation helper for inspection reports.
 *
 * Calls Cloudflare Browser Rendering (env.BROWSER) to fetch a public report
 * URL and convert it to PDF. The binding is OPTIONAL — callers MUST handle
 * the thrown error and fall back to text-only delivery (browser print on
 * the client side stays available either way).
 *
 * Free tier on Workers Paid plan: 1000 requests/day. Track quota via
 * scheduled handler if usage approaches limit.
 */

const PDF_TIMEOUT_MS = 30_000;

export async function generatePdfFromUrl(
    browser: Fetcher | undefined,
    url: string,
): Promise<ArrayBuffer> {
    if (!browser) {
        throw new Error('PDF generation unavailable: BROWSER binding not configured');
    }

    // Append print-mode hint so the page can render slightly differently if
    // it wants to (currently the @media print stylesheet handles it).
    const renderUrl = url.includes('?') ? `${url}&print=1` : `${url}?print=1`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PDF_TIMEOUT_MS);

    try {
        const res = await browser.fetch(renderUrl, {
            method: 'GET',
            signal: ctrl.signal,
            // CF Browser Rendering returns a PDF when this header is set
            headers: { 'Accept': 'application/pdf' },
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => '<no body>');
            throw new Error(`PDF rendering failed (${res.status}): ${detail.slice(0, 200)}`);
        }

        return await res.arrayBuffer();
    } finally {
        clearTimeout(timer);
    }
}
