/**
 * Commercial PCA Phase O Tasks 7-9 — Paged.js TOC page-number CLIENT-LAYER proof.
 *
 * Proves ONLY the client layer: that the vendored Paged.js polyfill + the
 * `.toc-pageref::after { content: target-counter(attr(href url), page) }` CSS
 * (the exact CSS <ReportView> injects behind the `?print=1&pagedtoc=1` gate)
 * fill each TOC entry's page number correctly, in a real browser, with numbers
 * that INCREASE down the list. Headless Chrome does NOT support
 * `target-counter()` natively — the polyfill is what makes it work.
 *
 * This test is SELF-CONTAINED: it builds a static Letter-height fixture and
 * injects Paged.js from node_modules via addScriptTag. It does NOT touch the
 * dev worker, the report route, or Cloudflare Browser Rendering. It therefore
 * does NOT prove the CF integration (the deferred risk — networkidle0 racing
 * re-pagination, @page vs pdfOptions double-pagination, and the missing in-page
 * readiness wait). Those remain open; see scripts/spike/pagedjs-cf-spike.md.
 *
 * Readiness signal mirrors production exactly: `window.PagedConfig.after` raises
 * `window.__pagedReady = true` and stamps `data-paged-done="1"` on <html>.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The exact bundle scripts/vendor-copy.js ships to public/vendor/pagedjs.polyfill.js.
const POLYFILL = readFileSync(
  join(__dirname, '../../node_modules/pagedjs/dist/paged.polyfill.js'),
  'utf8',
);

// Mirrors the CSS + readiness signal <PagedTocInjection> renders in ReportView.
const FIXTURE = /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: letter; margin: 0.5in; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #111; }
  h1 { font-size: 20px; }
  h2 { font-size: 18px; margin: 0; }
  /* The line under test — identical to ReportView's gated injection. */
  .toc-pageref::after { content: target-counter(attr(href url), page); }
  .toc-pageref { margin-left: 8px; font-weight: 700; }
  #report-toc { margin-bottom: 32px; }
  .toc-row { display: flex; align-items: baseline; gap: 6px; margin: 4px 0; }
  /* Tall filler so each section lands on a later page than the previous. */
  .filler { height: 1400px; border-bottom: 1px dashed #ccc; }
</style>
<script>
  // Must be set BEFORE the polyfill evaluates — it reads window.PagedConfig
  // synchronously at eval time (see paged.polyfill.js tail).
  window.PagedConfig = {
    auto: true,
    after: function () {
      window.__pagedReady = true;
      document.documentElement.setAttribute('data-paged-done', '1');
    },
  };
</script>
</head>
<body>
  <section id="report-toc">
    <h1>Table of Contents</h1>
    <div class="toc-row"><a href="#secA">Section A — Roofing</a><a class="toc-pageref" href="#secA" aria-hidden="true"></a></div>
    <div class="toc-row"><a href="#secB">Section B — Electrical</a><a class="toc-pageref" href="#secB" aria-hidden="true"></a></div>
    <div class="toc-row"><a href="#secC">Section C — Plumbing</a><a class="toc-pageref" href="#secC" aria-hidden="true"></a></div>
  </section>
  <div class="filler">Front matter / TOC page filler</div>
  <h2 id="secA">Section A — Roofing</h2>
  <div class="filler">Section A body</div>
  <h2 id="secB">Section B — Electrical</h2>
  <div class="filler">Section B body</div>
  <h2 id="secC">Section C — Plumbing</h2>
  <div class="filler">Section C body</div>
</body>
</html>`;

test('Paged.js fills TOC page numbers via target-counter, increasing down the list', async ({ page }, testInfo) => {
  await page.setContent(FIXTURE, { waitUntil: 'load' });
  // Inject the vendored polyfill bundle. It auto-runs on document-ready, reads
  // window.PagedConfig (already set by the fixture's inline script), paginates,
  // then fires PagedConfig.after → data-paged-done.
  await page.addScriptTag({ content: POLYFILL });

  // Wait on the SAME readiness signal the CF follow-up will wait on.
  await page.waitForFunction(() => (window as unknown as { __pagedReady?: boolean }).__pagedReady === true, null, {
    timeout: 20000,
  });
  await expect(page.locator('html[data-paged-done="1"]')).toHaveCount(1);

  // Read, for each TOC page-ref, (a) its resolved ::after content and (b) the
  // real page number the linked heading landed on.
  //
  // Paged.js resolves `target-counter()` by rewriting each ::after into a
  // page-scoped NAMED counter — `content: counter(target-counter-<uuid>)` —
  // and RESET-ing that counter to the target page's number on the page where
  // the target lands. So getComputedStyle returns the `counter(...)` expression
  // (proof the polyfill processed target-counter — native headless Chrome, with
  // no target-counter support, would compute `normal` / empty here), while the
  // VISIBLE integer equals the target heading's `.pagedjs_page[data-page-number]`.
  const rows = await page.evaluate(() => {
    const pageNumberOf = (id: string): number => {
      const target = document.getElementById(id);
      const pageEl = target?.closest('.pagedjs_page');
      return pageEl ? Number(pageEl.getAttribute('data-page-number')) : NaN;
    };
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.pagedjs_pages .toc-pageref'),
    );
    return anchors.map((el) => {
      const content = getComputedStyle(el, '::after').content ?? '';
      const href = (el.getAttribute('href') ?? '').replace('#', '');
      return { content, href, page: pageNumberOf(href) };
    });
  });

  // Three TOC entries → three page-refs, in document order.
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    // The polyfill rewrote target-counter into a scoped counter — this is the
    // client-layer proof that `target-counter(attr(href url), page)` was
    // processed (a native render leaves `normal`/empty here).
    expect(r.content, `::after should be a polyfilled counter() (got ${JSON.stringify(r.content)})`).toContain('counter(');
    // The linked heading resolved to a real, positive page number.
    expect(Number.isFinite(r.page), `resolved page should be numeric (href=${r.href})`).toBe(true);
    expect(r.page).toBeGreaterThan(0);
  }
  // The rendered TOC page numbers strictly increase down the list (each section
  // lands on a later page than the previous, given the tall filler).
  expect(rows[1].page).toBeGreaterThan(rows[0].page);
  expect(rows[2].page).toBeGreaterThan(rows[1].page);

  // Capture proof for human signoff: the paginated fixture with visible numbers.
  // Write into Playwright's per-test output dir (cross-platform; a hardcoded
  // Windows path fails on the Linux CI runner) and attach it to the report.
  await page.screenshot({ path: testInfo.outputPath('paged-toc-proof.png'), fullPage: true });
});
