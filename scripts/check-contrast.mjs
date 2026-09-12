#!/usr/bin/env node
/**
 * WCAG AA contrast guard for small text, across `packages/shared-ui/src` and `app`.
 *
 * Why this exists as a SEPARATE gate from `lint:ds`:
 * `check-ds-tokens.mjs` validates token NAMES — that UI code says
 * `text-ih-fg-4` instead of `text-slate-400`. It is completely blind to what
 * those tokens are WORTH. Five form controls shipped their `hint` line as
 * `text-[11px] text-ih-fg-4`, which is 2.56:1 on a light card and 3.07:1 on a
 * dark one — against a 4.5:1 requirement — and `lint:ds` was green on all five
 * for as long as they existed. A name check cannot see that; arithmetic can.
 *
 * What it checks: every class string that sets BOTH a small text size
 * (<= MAX_SMALL_PX) and an unprefixed `text-ih-*` foreground must clear 4.5:1
 * against the surface it is drawn on, in EVERY theme the stylesheet declares.
 *
 * ── Which surface (the part that decides whether this gate is usable) ──
 * The shared-ui-only version assumed ONE surface, `--ih-bg-card`. Run unchanged
 * over `app/`, that assumption produced 109 reports of `text-ih-fg-inverse` —
 * white text scored against a white card, 1.00:1 — every one of them white text
 * on a FILLED BUTTON and perfectly legible. A gate that is wrong 109 times gets
 * switched off, so surface inference comes first and the colour edits second.
 *
 * Surface is resolved per class string, in this order:
 *   1. a `contrast-surface: bg-ih-…` annotation in a comment on (or just above)
 *      the line — the author naming the surface an ancestor paints;
 *   2. an unprefixed `bg-ih-*` in the SAME class string — the element painting
 *      its own surface. Authoritative: same `className`, no ambiguity;
 *   3. otherwise `REFERENCE_SURFACE` (`--ih-bg-card`).
 *
 * Anything that cannot be turned into a colour — two unprefixed backgrounds on
 * one element, an alpha modifier (`bg-ih-bg-app/40`), a translucent token
 * (`--ih-primary-tint` is `rgba(…)`), or a `bg-ih-*` with no `@theme` entry — is
 * UNRESOLVED: skipped, counted, and the tally printed on every run. A gate that
 * silently declines to look is indistinguishable from one that looked and
 * approved.
 *
 * ── Four things it reads BESIDES class strings ──
 * Each was listed below as a blind spot, and each let a real defect through.
 *   - `checkAliasDefinitions` — an `@theme` alias whose `--ih-*` property is
 *     DECLARED NOWHERE. Previously that made the token unreadable, which the
 *     per-theme loop read as "not measurable" and skipped in silence while the
 *     alias's `var(…, #fff)` fallback shipped one fixed colour to three themes.
 *     `--ih-primary-fg` was in that state: 2.98:1 on the dark/field primary fill.
 *   - `cssTextRules` — colours set in the STYLESHEET rather than in a utility.
 *     `.ih-eyebrow` (`color: var(--ih-fg-4)` at 9px, 2.56:1 on a light card) was
 *     the example named in this comment and was still live when a runtime probe
 *     found it in the browser. `.ih-kbd` and `.ih-pill--ni` came with it.
 *   - Class fragments inside a template literal's `${…}`. The lexer skipped the
 *     whole substitution, so `${active ? "…" : "bg-ih-bg-muted text-ih-fg-4"}`
 *     was invisible — that is the TabStrip count pill, 2.34:1 in light. They are
 *     now lexed and paired back with the enclosing template, which is where the
 *     size and often the surface live.
 *   - An UNMEASURABLE pairing (one side not a hex colour) is counted and printed
 *     instead of being dropped. Silence was the defect, not the arithmetic.
 *
 * Two numbers are printed on every run — what was checked and what was skipped,
 * per dimension. A gate that prints only a verdict cannot be audited on the day
 * it goes green.
 *
 * WHAT THIS CANNOT SEE, stated plainly:
 *   - Text painted by an ANCESTOR's background. Rule 2 reads only the element's
 *     own class string. Ancestor inference was measured before being rejected:
 *     walking the JSX upward by indentation would have excused 0 of the 579
 *     reports on this tree (every resolvable ancestor here is bg-card / bg-app /
 *     bg-muted, none of which rescues a failing pairing), so it buys no
 *     false-positive reduction and its only realistic effect is to excuse real
 *     failures whenever it guesses the ancestor wrong — which it does, e.g. on
 *     `bg-ih-bg-muted/60`. Rule 1 is the manual override instead. Cost, measured
 *     after the repairs: 36 sites are drawn on an un-annotated ancestor surface
 *     worse than the card and read as clean here — 32 of them `--ih-fg-3` on
 *     light `--ih-bg-muted`, 4.34:1. `scripts/lib/contrast-scan.mjs` has no
 *     answer to this; a light `--ih-fg-3` one step darker (#5f6d80 is 4.81:1 on
 *     muted, 5.27:1 on card) would remove the whole class, and is a palette
 *     decision, not a scanner one.
 *   - Class strings that set a colour and NO size, where the colour is also not
 *     in a template literal this scanner can borrow a size from. Still the
 *     largest remaining gap, and still ~149 unprefixed `text-ih-fg-4` call sites
 *     wide. The size-independent rule for sub-3:1 pairings now runs wherever a
 *     CSS rule supplies the colour, but a bare `className="text-ih-fg-4"` has no
 *     size anywhere to read, and turning that into a failure means a 149-site
 *     repair sweep with its own design decisions (`--ih-fg-4` is a legitimate
 *     DECORATION tier — chevrons, dividers, placeholders — so darkening the token
 *     is not the fix). `docs/develop/design-system.md` states the rule in prose:
 *     helper text is `ih-fg-3`, never `ih-fg-4`.
 *   - Class strings assembled from literals that are NOT in the same template —
 *     a colour in a module-level `const` joined to a size at the call site. The
 *     `${…}` case is covered now; a cross-binding one would need real data flow.
 *   - Alpha on the FOREGROUND (`text-ih-fg-3/70`) is measured at full opacity:
 *     optimistic, so it under-reports and never over-reports.
 *   - Colours set in CSS on a selector whose SIZE is neither in the rule nor in
 *     its BEM base class, and whose pairing is 3:1 or better. Measurable only
 *     once something names the size.
 *   - THE TENANT'S BRAND COLOUR, which is the largest blind spot by far and the
 *     one most likely to be mistaken for coverage. Every public surface —
 *     booking, client portal, report, invoice, payment — re-points
 *     `--ih-primary` at a colour stored in the database, injected as an inline
 *     style by `brandTokens()` at request time. It is not in this stylesheet, so
 *     nothing below ever sees it. Measured over the sRGB cube: 63.6% of colours
 *     fail AA as brand-coloured TEXT on white, and 6.7% admit no readable
 *     foreground at all when used as a button fill. This gate scores the
 *     platform defaults and says NOTHING about any of that. What guards it is
 *     `app/lib/brand.ts` — `brandTextColor()` derives a text-safe variant into
 *     `--ih-primary-text`, `contrastForeground()` picks the on-fill colour by
 *     measured ratio — under a property test in `app/lib/brand.test.ts` that
 *     samples the cube. Runtime colour needs a runtime guarantee; a green run
 *     here is not one. TOKEN_INVARIANTS below is the static half of that pair.
 *
 * Escape hatches, all staleness-guarded so they cannot rot:
 *   - KNOWN_DEBT — one call site, matched against live code; a stale entry FAILS.
 *   - PALETTE_DEBT — one (foreground, surface, theme) colour pair with its
 *     measured ratio PINNED. An entry that matches nothing, or whose ratio has
 *     moved, FAILS. That is what makes it a record rather than a mute button.
 *   - a `contrast-surface:` annotation on a site that passes without it FAILS.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  classChunks,
  smallestSize,
  foregroundTokens,
  backgroundTokens,
  surfaceAnnotations,
  resolveSurface,
} from "./lib/contrast-scan.mjs";
import {
  AA_NORMAL,
  THEMES,
  parseHex,
  luminance,
  contrastRatio,
  resolveVar,
  aliasMap,
  aliasFallbacks,
  cssTextRules,
} from "./lib/contrast-css.mjs";
import {
  AA_LARGE,
  REFERENCE_SURFACE,
  PALETTE_DEBT,
  TOKEN_INVARIANTS,
  checkTokenInvariants,
  checkAliasDefinitions,
} from "./lib/palette-invariants.mjs";
import {
  MAX_SMALL_PX,
  KNOWN_DEBT,
  surfaces,
  findViolations,
  findCssRuleViolations,
} from "./lib/contrast-gate.mjs";
import { reportFindings } from "./lib/contrast-report.mjs";

// Re-exported so the spec (and any other caller) keeps one import site even
// though the implementation now lives in three files.
export { classChunks, smallestSize, foregroundTokens, backgroundTokens, surfaceAnnotations };
export { resolveSurface };
export { AA_NORMAL, THEMES, parseHex, luminance, contrastRatio, resolveVar, aliasMap };
export { AA_LARGE, aliasFallbacks, cssTextRules, checkAliasDefinitions };
export { REFERENCE_SURFACE, PALETTE_DEBT, TOKEN_INVARIANTS, checkTokenInvariants };
export { MAX_SMALL_PX, KNOWN_DEBT, surfaces, findViolations, findCssRuleViolations };

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = [join("packages", "shared-ui", "src"), "app"];
const CSS_PATH = join("app", "styles", "tailwind.css");

/* ───────────────────────────── source scanning ──────────────────────────── */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "paraglide" && name !== "node_modules") walk(full, acc);
    } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function main() {
  const css = readFileSync(join(ROOT, CSS_PATH), "utf8");
  const files = SCAN_DIRS.flatMap((dir) =>
    walk(join(ROOT, dir)).map((full) => ({
      path: relative(ROOT, full).split(sep).join(sep),
      source: readFileSync(full, "utf8"),
    })),
  );
  process.exit(reportFindings(findViolations({ css, files }), { css, cssPath: CSS_PATH }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join("/"))) main();
