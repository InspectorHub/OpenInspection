/**
 * Renders the Paged.js polyfill + `target-counter()` CSS that fill the report
 * TOC's per-entry page numbers ("§5 Roofing ...... 12"). Headless Chrome does
 * NOT support `target-counter()` natively, so the polyfill re-paginates the DOM
 * and resolves the counters against its own `@page` model.
 *
 * MOUNTED ONLY behind the `?print=1&pagedtoc=1` gate (see <ReportView> caller).
 * When the gate is off nothing here renders and the report is byte-identical to
 * the pre-Paged.js output — so the current production PDF (which never sends the
 * param) is completely untouched.
 *
 * Readiness signal: the vendored `paged.polyfill.js` auto-runs on document-ready
 * and reads `window.PagedConfig`. We set `PagedConfig.after(done)` — Paged.js
 * invokes it AFTER the preview flow finishes re-paginating — to raise
 * `window.__pagedReady = true` and stamp `data-paged-done="1"` on <html>. The CF
 * follow-up will wait on that signal before capturing the PDF (the spike's
 * Step-3 risk: `quickAction('pdf')` may not expose an in-page wait hook — see
 * scripts/spike/pagedjs-cf-spike.md). The inline PagedConfig script MUST
 * precede the polyfill <script> because the bundle reads `window.PagedConfig`
 * synchronously at eval time.
 */
export function PagedTocInjection() {
  // `target-counter(attr(href url), page)` — for each `.toc-pageref` anchor,
  // resolve the page on which its href target lands and print it via ::after.
  // The @page size matches CF's Letter pdfOptions; margins kept minimal — the CF
  // follow-up must reconcile these against pdfOptions to avoid double pagination.
  const css = `
    @page { size: letter; margin: 0.5in; }
    .toc-pageref::after { content: target-counter(attr(href url), page); }
  `;
  const readySignal = `
    window.PagedConfig = window.PagedConfig || {};
    window.PagedConfig.auto = true;
    window.PagedConfig.after = function () {
      window.__pagedReady = true;
      document.documentElement.setAttribute('data-paged-done', '1');
    };
  `;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <script dangerouslySetInnerHTML={{ __html: readySignal }} />
      <script src="/vendor/pagedjs.polyfill.js" />
    </>
  );
}
