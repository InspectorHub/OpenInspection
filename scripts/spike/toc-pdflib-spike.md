# Spike: TOC page numbers via Chrome link annotations + pdf-lib (Task 18)

**Verdict: PASS ✅** — implement the two-pass pdf-lib approach (Task 19a).

## Question
Does Chrome's `page.pdf()` encode intra-doc `<a href="#id">` TOC links as link
annotations with a destination that pdf-lib can resolve to the target **page
number**? (The two-pass TOC-page-number plan depends on this.)

## Method
`scripts/spike/toc-pdflib-spike.mjs` (throwaway) renders a fixture that mirrors
`app/components/portal/sections/report/ReportToc.tsx` — a TOC of `<a href="#id">`
entries plus the reserved empty `.toc-pageref` slot, then tall `<h2 id>` sections
that each land on a later page — using **Playwright's bundled Chromium**
(`page.pdf({ format: 'Letter' })`). Playwright Chromium is the same engine CF
Browser Rendering uses (Chromium via Puppeteer), so this validates the CF path.
Then `pdf-lib` reads the annotations.

## Findings
- Chrome emits **one `/Subtype /Link` annotation per TOC entry** (5/5), all on the
  TOC page.
- The destination is a **named destination** (`PDFName`), NOT an inline
  `[pageRef …]` array — so a naive array reader returns null (first spike run did).
  Resolving requires walking the catalog **`/Names → /Dests` name tree**.
- **The destination name === the element `id`** verbatim: `"roof"`, `"structural"`,
  `"mechanical"`, `"electrical"`, `"plumbing"`. So the anchor→page correlation is
  robust by name (no fragile ordering/position matching needed).
- Each name resolves through the name tree to the target page's indirect ref,
  which maps to the correct **1-based page number**: 3, 5, 7, 9, 11 (strictly
  increasing, one per section) — exactly the pages the sections land on.

## Implementation implication (Task 19a)
`extractAnchorPages(pdfBytes) -> Record<anchorId, pageNumber>` = walk
`catalog /Names /Dests` (+ legacy `catalog /Dests`), for each named dest resolve
its array's first element (page ref) to a 1-based index; the name is the anchor id.
Two-pass: (1) render → `extractAnchorPages` → `{id: page}`; (2) re-render with the
map injected into the TOC (`ReportToc` fills each `.toc-pageref` from the map).
Because the numbers land in the already-reserved TOC slot, pass-2 pagination equals
pass-1 → numbers are correct without iteration.

## Caveats / still to validate on the REAL report (do in Task 19a E2E / prod)
- The fixture is synthetic (like the old Paged.js false-green) — BUT it validates a
  structure-independent Chrome mechanism (any `<a href="#id">` + `id` target yields
  a named dest). The real report already uses exactly this structure. Still: assert
  on a real worker-rendered PCA report that every TOC outline id appears as a named
  dest and resolves (guard against a section heading missing its `id`).
- Cost: two Browser Rendering passes per render (~2×). Gated + content-hash cached,
  so only on actual content change. Note the CF Free 10-min/day budget halves.
- This fully replaces the gated Paged.js `target-counter` path (remove it).
