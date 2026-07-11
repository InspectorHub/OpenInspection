# Commercial PCA Phase W — Task 1 spike decision (`docx`-on-Workers GO/FALLBACK gate)

Plan: `docs/superpowers/plans/2026-06-26-commercial-pca-phase-w-plan.md`, Task 1.
Issue: `#186`.
Date: 2026-07-12.
`docx` version installed: `9.7.1`.

## Verdict: **GO**

Both gates pass. `docx` (dolanmiu) stays in `dependencies`. Proceed to Task 2 with
the `docx` builder approach (no fallback re-scope needed).

---

## Gate A — does `docx` run under workerd + R2 round-trip?

**Result: PASS.**

- Added `docx@9.7.1` to `dependencies` via `npm install docx`.
- Wrote `tests/workers/word-export-spike.spec.ts` (real workerd, `vitest.workers.config.ts`,
  imports from `'docx'` and `'cloudflare:test'`):
  - builds a `Document` with `features.updateFields`, a `TableOfContents`,
    a `HEADING_1` paragraph, and a body paragraph;
  - `Packer.toBuffer(doc)` → `Uint8Array`, asserts non-empty + PK zip magic
    (`bytes[0]===0x50 && bytes[1]===0x4b`);
  - round-trips the bytes through the `PHOTOS` R2 binding (`put` → `get` →
    `arrayBuffer()`), asserts byte-length equality AND full byte-for-byte
    equality (`toEqual`);
  - `PHOTOS.delete(key)` cleanup.
- Ran solo, foreground: `npm run test:workers -- word-export-spike`.

Tally:
```
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  2.44s (transform 947ms, setup 0ms, import 1.82s, tests 93ms)
Exit code: 0
```

No `fs`/`stream`/`Buffer`-not-defined error, no CJS-eval crash. `Packer.toBuffer`
executed cleanly inside the real workerd isolate (not just Node), and the R2
round-trip was byte-exact. One harmless teardown log line appears after the
run (`exception = workerd/api/web-socket.c++:821: disconnected: WebSocket
peer disconnected`) — this is `@cloudflare/vitest-pool-workers` isolate
teardown noise, not a test failure; exit code is 0 and both the test-file and
test counters report 1/1 passed.

Static check on the installed package before running: `node_modules/docx/dist/index.mjs`
(the module resolved via `docx`'s `module` field) contains no `require('fs')`,
no `require('stream')`, and no `import ... from 'node:*'` — it does reference
`Buffer` (165 call sites), which resolves via the worker's `nodejs_compat`
compatibility flag (already enabled in `wrangler.jsonc`:
`compatibility_flags: ["nodejs_compat"]`, `compatibility_date: 2026-05-22`).

## Gate B — bundle-size impact

**Result: PASS.**

Found the real gate: `npm run check:bundle` → `scripts/check-bundle-size.mjs`.
It runs the exact deploy pipeline (`npm run build` then
`wrangler deploy --dry-run -c build/server/wrangler.json`) and parses
wrangler's own `Total Upload: X KiB / gzip: Y KiB` line — the authoritative
number, not an estimate. Hard limit: 3 MiB (3072 KiB) gzip (Workers Free
script-size cap); warn threshold 85%.

**Baseline (before `docx`, `main`/`feat/pca-mtpow` tip, no code changes):**
```
worker upload: 17465 KiB raw / 2658 KiB gzip (86.5% of the 3 MiB Workers Free limit)
```
Headroom at baseline: `3072 − 2658 = 414 KiB` (13.5%).

**Measured impact of actually including `docx` in the module graph:**
Rather than estimate from the raw npm package size, forced a real measurement:
temporarily added a throwaway file (`server/lib/_spike-docx-import.ts`,
never committed) importing the classes Task 2+ will actually use
(`Document, Packer, Paragraph, HeadingLevel, TableOfContents, Table, TableRow,
TableCell, ImageRun`) and a one-line import of it from `server/index.ts`, ran
`npm run check:bundle`, then reverted both files before committing anything
(`git diff server/index.ts` confirmed clean; the throwaway file was deleted).

```
worker upload: 17977 KiB raw / 2775 KiB gzip (90.3% of the 3 MiB Workers Free limit)
```

- **Delta from `docx`: +117 KiB gzip** (2775 − 2658), well below a naive
  estimate from the raw dist file (`node_modules/docx/dist/index.mjs` alone
  gzips to ~214.5 KiB / 219,605 bytes standalone — wrangler's esbuild pass
  tree-shook/minified/deduped the actually-referenced surface down to
  ~117 KiB in the context of the full worker bundle).
- **Remaining headroom after adding `docx`: `3072 − 2775 = 297 KiB` (9.7% of
  the limit).** Still under the hard 3 MiB cap, but the WARNING threshold
  (85%) was already tripped at baseline and stays tripped (90.3% now) — this
  is pre-existing, not caused by this spike, but it means Task 2–6's actual
  production builder code (plus any further growth elsewhere in the worker)
  has materially less than 297 KiB of margin left before the gate goes red.
  Flagging for Task 2+ implementers and for the broader bundle-diet backlog
  (`docs/superpowers/plans/2026-07-06-oi-knip-verified-cleanup-backlog.md` /
  the pre-push WARNING).
- `docx`'s own dependencies (`jszip`, `nanoid`, `xml`, `xml-js`, `hash.js`)
  are pre-bundled into `docx`'s own `dist/index.mjs` (a single-file rollup) —
  no additional transitive packages were pulled into the worker's module
  graph beyond what that one import already carries.

## Manual three-reader verification (Step 3 of the plan)

**REQUIRED BUT DEFERRED — not a blocker for this GO decision.** This
environment cannot open files in Microsoft Word, LibreOffice Writer, or
Google Docs. Per the task instructions this is explicitly non-automatable
and is NOT gating Task 1's code-level decision. It MUST be performed before
Task 6 ships to end users: verify the native `TableOfContents` field offers
"Update Table" and populates with headings + page numbers, an embedded
`ImageRun` renders, a `Table` renders, and there are no blank regions (the
`altChunk`-style failure mode) in all three readers. Track this as an open
follow-up against Task 6 Step 5 (which already calls for local E2E +
Word fidelity checks) — extend it explicitly to LibreOffice + Google Docs
before Phase W is considered production-ready.

## Files touched by this spike

- `package.json` / `package-lock.json` — `docx@9.7.1` added to `dependencies` (kept, GO).
- `tests/workers/word-export-spike.spec.ts` — kept as a permanent regression guard
  (real-workerd proof that `docx` + R2 keep working as the dependency updates).
- `scripts/spike/word-export-spike.md` — this file.
- No production code was added. `server/index.ts` and all other application
  files are unchanged from before this spike (the Gate B throwaway import was
  reverted).
