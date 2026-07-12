# Spike: Paged.js × Cloudflare Browser Run — TOC page numbers (Commercial PCA Phase O, Task 1)

**Verdict: FALLBACK** — page-numbered TOC deferred. Ship the numberless clickable TOC + heading-derived PDF bookmarks (Phase O Tasks 2–6). Do not implement Tasks 7–9 until a follow-up resolves this GO.

## Question
Can Paged.js run inside the CF Browser Run headless page, paginate the report HTML, fill `target-counter` page numbers for the TOC anchors, and let the rasterize step capture the result without racing the capture / double-paginating against CF's own page model / off-by-one footers?

## Why FALLBACK (evidence + reasoning)
The page-number path cannot be **honestly verified** from this environment, and project convention (`verification-before-completion`; the plan's Task 8 Step 3: *"page numbers must be eyeballed against a locally rendered PDF — do not claim it from code inspection"*) forbids shipping it unverified.

1. **Requires a real CF Browser Run render.** The production PDF primitive is `generatePdfFromUrl` → `env.BROWSER.quickAction('pdf', { url })` (Cloudflare Browser Rendering binding). Proving Paged.js composes with it requires rendering a deployed report URL through a real CF account and opening the resulting PDF. This autonomous local worktree does not deploy and has no bound `BROWSER` in a locally-drivable form.
2. **CF Browser Run free-tier is flaky.** Prior project experience (memory `reference_cf_browser_rendering_account`): the free tier rasterizes error pages and fails on consecutive requests — an unreliable base to prove a subtle pagination-timing integration on.
3. **The core unproven risk is a CF-only readiness hook.** `quickAction('pdf')` exposes only `gotoOptions`/`pdfOptions` — there is likely **no hook to wait for an in-page JS signal** (`window.__pagedReady` / `[data-paged-done]`). Whether `networkidle0` alone reliably lands *after* Paged.js finishes, or whether the path must drop to the lower-level Browser Rendering Puppeteer/REST surface, can only be determined against real CF — not locally. A local Paged.js DOM proof would NOT prove the CF integration (the actual risk).
4. **Footer reconciliation is CF-specific.** Whether CF's `pdfOptions` running footer "Page X / Y" agrees with Paged.js's `@page` boxes (vs off-by-one / double pagination) is observable only in a real CF-produced PDF.

## What ships now (FALLBACK deliverable — genuinely complete, locally tested)
- **O2** pure `buildReportOutline` projection over the tier-gated Phase S registry.
- **O3** `outline` emitted from `getReportData` + threaded through `ReportLoaderResult` + all loader construction sites.
- **O4** `<ReportToc>` — clickable two-level TOC, RR manual-scroll anchors.
- **O5** TOC rendered in the reserved slot; every outline id stamped to a real DOM anchor (no dangling anchors); level-1 system chapters get anchor dividers.
- **O6** section headings are real `<h2 id=…>` elements → CF Browser Run derives a document outline (PDF bookmark pane) from heading structure with no extra option. (Bookmark-pane visual confirmation is part of the same deferred real-PDF check, but bookmarks do NOT depend on Paged.js and ship on the FALLBACK path.)

## Follow-up to reach GO (out of scope for this autonomous run)
On a deployed environment with a real `BROWSER` binding: vendor Paged.js (`pagedjs` devDep + `scripts/vendor-copy.js` entry → `public/vendor/pagedjs.polyfill.js`), inject it behind `printMode`, add `.toc-pageref::after { content: target-counter(attr(href url), page) }`, determine the CF readiness-wait mechanism (Step 3 risk), reconcile the footer, bump `RENDER_VERSION`, and **eyeball a real PDF** for ±0 page-number accuracy before shipping Tasks 7–9.

---

## Client layer implemented (gated) — remaining CF verification

The **client layer** of the follow-up above is now implemented and proven in a
real browser, but kept **strictly opt-in** so production PDFs are untouched. The
CF integration (the actual deferred risk) is still unverified.

### What ships now (behind the gate — DEFAULT render is byte-for-byte unchanged)
- **Vendored polyfill**: `pagedjs` devDependency + a `scripts/vendor-copy.js`
  entry copying `node_modules/pagedjs/dist/paged.polyfill.js` →
  `public/vendor/pagedjs.polyfill.js` (`public/vendor/` is gitignored, vendored
  at build). Script-injected, never bundled.
- **Opt-in gate**: a new query param `pagedtoc=1` (only meaningful with
  `print=1`). `app/routes/public/report-card-stack.tsx` reads
  `pagedToc = searchParams.get("pagedtoc") === "1"` and threads a `pagedToc`
  boolean through the report data (new field on `ReportLoaderResult` in
  `app/components/portal/sections/report/types.ts`, defaulted `false` in every
  fallback path and in the inline-Hub loader `app/lib/section-loaders.ts`).
- **Injection (gated on `data.pagedToc`)** in
  `app/components/portal/sections/ReportView.tsx` (`<PagedTocInjection>`):
  passes `showPageNumbers={data.pagedToc === true}` to `<ReportToc>`, then
  renders `<style>` with `@page { size: letter; margin: 0.5in }` +
  `.toc-pageref::after { content: target-counter(attr(href url), page) }`, an
  inline `window.PagedConfig` script, and
  `<script src="/vendor/pagedjs.polyfill.js">`.
- **Readiness signal**: the vendored bundle auto-runs on document-ready and
  reads `window.PagedConfig` **synchronously at eval time** (so the inline
  config script must precede the polyfill `<script>`). We set
  `PagedConfig.after` — Paged.js invokes it AFTER the preview flow finishes
  re-paginating — to raise `window.__pagedReady = true` and stamp
  `document.documentElement.setAttribute('data-paged-done','1')`. (API used:
  `window.PagedConfig.{auto, after}` from the polyfill's auto-run block; the
  bundle also exposes `window.Paged.{Previewer, registerHandlers, …}` if a
  handler-based approach is ever preferred.)
- **`RENDER_VERSION` bumped `r5` → `r6`** in `server/lib/pdf.ts` (comment notes
  the gated Paged.js path; `generatePdfFromUrl` does NOT yet send the param).
- **Client proof**: `tests/e2e/report-toc-pagednumbers.spec.ts` (Playwright,
  self-contained: `page.setContent` of a Letter-height fixture + Paged.js from
  `node_modules` via `addScriptTag`, no dev worker / D1 / CF). It waits on
  `data-paged-done`, asserts each `.toc-pageref::after` was rewritten into a
  polyfilled `counter(…)` (native headless Chrome, lacking `target-counter`,
  computes `normal`/empty here), and asserts the linked headings resolve to
  strictly-increasing real page numbers (`.pagedjs_page[data-page-number]`).
  Screenshot proof: `D:/tmp/oi-paged-toc-proof.png` (TOC shows 2 / 3 / 4).

  > Note on the assertion: Paged.js resolves `target-counter()` into a
  > page-scoped **named** counter (`content: counter(target-counter-<uuid>)`),
  > so `getComputedStyle(el,'::after').content` returns the `counter(…)`
  > expression rather than the digit. The **visible** integer equals the target
  > heading's page (`.pagedjs_page[data-page-number]`), which the test reads
  > directly — this is what a human sees in the screenshot.

### Remaining steps — REQUIRE a deployed `BROWSER` binding (still DEFERRED)
These are the GO gate; do NOT flip the gate on in production until all pass on a
real CF-produced PDF.

1. **Make `generatePdfFromUrl` request the gate + wait for readiness.** Append
   `&pagedtoc=1` to `renderUrl` and wait for the in-page `[data-paged-done]` /
   `window.__pagedReady` signal before capture. **Step-3 risk (unchanged):**
   `env.BROWSER.quickAction('pdf', …)` exposes only `gotoOptions` / `pdfOptions`
   — there is likely **no hook to wait on an in-page JS signal**. Two options to
   evaluate against real CF:
   - **(a)** Rely on `gotoOptions.waitUntil: 'networkidle0'` alone and empirically
     confirm it lands *after* Paged.js finishes re-paginating (unproven — Paged.js
     mutates the DOM synchronously after load with no network activity, so
     `networkidle0` may fire too early).
     ▸ A middle-ground within `quickAction`: keep the report page itself from
     signalling "ready" until Paged.js is done — e.g. hold a pending sentinel
     `fetch()` / delay a tracked request until `PagedConfig.after`, so
     `networkidle0` cannot resolve early. Hacky; verify it actually gates capture.
   - **(b)** Drop to the lower-level Browser Rendering **Puppeteer/REST** surface
     (`page.goto` + `page.waitForSelector('[data-paged-done]')` + `page.pdf(...)`),
     which CAN wait on an in-page signal. More control, more code than `quickAction`.
2. **Reconcile Paged.js `@page` vs CF `pdfOptions`.** Both define page size +
   margins. Paged.js paginates into its own `@page` boxes; CF's `pdfOptions`
   (`format: 'letter'`, `margin: {…}`) then prints. If both apply, expect
   **double pagination** and/or **off-by-one running footers** ("Page X / Y").
   Options: let Paged.js own geometry and neuter CF's (`margin: 0`, no `format`),
   OR keep CF's and strip Paged's `@page` margins. Determine empirically.
3. **Eyeball a real CF PDF for ±0 TOC page-number accuracy** before enabling the
   gate in production (project convention: page numbers must be verified against
   a rendered PDF, never claimed from code). Confirm each TOC number matches the
   page the section actually starts on, and the running footer total agrees.

Until 1–3 pass on real CF, `generatePdfFromUrl` stays as-is (no `pagedtoc=1`) and
the production PDF is unaffected.
