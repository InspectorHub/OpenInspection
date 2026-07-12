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
