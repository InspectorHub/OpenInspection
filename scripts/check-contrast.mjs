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
 *   - Class strings that set a colour and NO size — the size is inherited, and
 *     inferring it needs the same ancestor walk rejected above. Measured: 230
 *     such strings pair a colour with a surface it fails on, 119 of them
 *     `text-ih-fg-4` on a card. That last group does not actually need the size:
 *     2.56:1 is below even WCAG's 3:1 large-text floor, so it fails at every
 *     size. A size-INDEPENDENT rule for sub-3:1 tokens is the obvious next
 *     extension and is deliberately not in this pass — it changes the gate's
 *     contract from "small text" to "all text" and needs its own repair sweep.
 *   - Class strings ASSEMBLED from several literals. The size and the colour
 *     have to be in the same string. `DefectCategoryChip` keeps its size in a
 *     template literal and its colour in a `const`, so its 9px muted pill was
 *     invisible here and was found by reading, not by the gate.
 *   - Alpha on the FOREGROUND (`text-ih-fg-3/70`) is measured at full opacity:
 *     optimistic, so it under-reports and never over-reports.
 *   - Colours set in CSS rather than utilities — `.ih-eyebrow` sets
 *     `color: var(--ih-fg-4)` at 9px and no class string mentions a token.
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
} from "./lib/contrast-css.mjs";

import {
  REFERENCE_SURFACE,
  PALETTE_DEBT,
  TOKEN_INVARIANTS,
  checkTokenInvariants,
} from "./lib/palette-invariants.mjs";

export { classChunks, smallestSize, foregroundTokens, backgroundTokens, surfaceAnnotations };
export { resolveSurface };
export { AA_NORMAL, THEMES, parseHex, luminance, contrastRatio, resolveVar, aliasMap };
export { REFERENCE_SURFACE, PALETTE_DEBT, TOKEN_INVARIANTS, checkTokenInvariants };

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = [join("packages", "shared-ui", "src"), "app"];
const CSS_PATH = join("app", "styles", "tailwind.css");

/** Anything at or below this renders as normal text for AA purposes. */
export const MAX_SMALL_PX = 14;

/**
 * Real AA failures at ONE call site that are deliberately not fixed, each with
 * the measured ratio. These are debt, not approvals. `match` must still be
 * found in `file`, otherwise the gate fails.
 */
export const KNOWN_DEBT = [];

/** Resolved reference-surface colour per theme. Throws if unreadable. */
export function surfaces(css) {
  return THEMES.map((t, i) => {
    const hex = resolveVar(css, i, REFERENCE_SURFACE);
    if (!parseHex(hex)) {
      throw new Error(
        `check-contrast: cannot read ${REFERENCE_SURFACE} for theme "${t.name}" ` +
          `(got ${hex}). The gate refuses to run half-blind.`,
      );
    }
    return { theme: t.name, hex };
  });
}

const surfaceOf = (chunk, alias, annotation) =>
  resolveSurface({ chunk, alias, annotation, reference: REFERENCE_SURFACE });

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

/* ─────────────────────────────── the gate ───────────────────────────────── */

/** Ratios equal to within this are "the same measurement". */
const RATIO_EPSILON = 0.005;

/**
 * Pure core. `files` is `[{ path, source }]`; `css` is the stylesheet text.
 * Returns `{ violations, staleDebt, stalePalette, uselessAnnotations,
 * unresolved, checked }`.
 */
export function findViolations({ css, files, debt = KNOWN_DEBT, palette = PALETTE_DEBT }) {
  const alias = aliasMap(css);
  surfaces(css); // fail loudly if the reference surface is unreadable
  const violations = [];
  const unresolved = [];
  const uselessAnnotations = [];
  const debtHits = new Set();
  const paletteHits = new Set();
  let checked = 0;

  const hexCache = new Map();
  const hexes = (prop) => {
    if (!hexCache.has(prop)) {
      hexCache.set(prop, THEMES.map((_, i) => resolveVar(css, i, prop)));
    }
    return hexCache.get(prop);
  };

  for (const { path, source } of files) {
    const annotations = surfaceAnnotations(source);
    for (const { text, line } of classChunks(source)) {
      const size = smallestSize(text);
      if (size === null || size > MAX_SMALL_PX) continue;
      const tokens = foregroundTokens(text);
      if (tokens.length === 0) continue;

      const annotation = annotations.get(line) ?? null;
      const surface = surfaceOf(text, alias, annotation);
      if (surface.unresolved) {
        unresolved.push({ path, line, why: surface.unresolved, snippet: text.trim() });
        continue;
      }
      const bgHexes = hexes(surface.prop);

      // What the surface would have been WITHOUT the annotation. An annotation
      // earns its place by changing the verdict; one that does not is a
      // suppression waiting to outlive its reason, so it is reported.
      const fallback = annotation
        ? surfaceOf(text, alias, null)
        : null;
      const fallbackHexes = fallback && !fallback.unresolved ? hexes(fallback.prop) : null;

      for (const token of tokens) {
        const prop = alias.get(token);
        if (!prop) continue; // not a colour alias — lint:ds owns that
        checked++;
        const fgHexes = hexes(prop);
        const failures = [];
        for (let i = 0; i < THEMES.length; i++) {
          const ratio = contrastRatio(fgHexes[i], bgHexes[i]);
          if (ratio === null) continue; // non-hex on either side — not measurable
          if (ratio < AA_NORMAL) {
            failures.push({ theme: THEMES[i].name, fg: fgHexes[i], bg: bgHexes[i], ratio });
          }
        }

        if (fallbackHexes && failures.length === 0) {
          const wouldFail = THEMES.some((_, i) => {
            const ratio = contrastRatio(fgHexes[i], fallbackHexes[i]);
            return ratio !== null && ratio < AA_NORMAL;
          });
          if (!wouldFail) {
            uselessAnnotations.push({ path, line, token: annotation.token, snippet: text.trim() });
          }
        }
        if (failures.length === 0) continue;

        const remaining = failures.filter((f) => {
          const hit = palette.find(
            (p) =>
              p.fg === prop &&
              p.bg === surface.prop &&
              p.theme === f.theme &&
              Math.abs(p.ratio - f.ratio) < RATIO_EPSILON,
          );
          if (hit) paletteHits.add(hit);
          return !hit;
        });
        if (remaining.length === 0) continue;

        const excused = debt.find((d) => d.file === path && text.includes(d.match));
        if (excused) {
          debtHits.add(excused);
          continue;
        }
        violations.push({
          path,
          line,
          size,
          token,
          prop,
          surface: surface.prop,
          origin: surface.origin,
          snippet: text.trim(),
          failures: remaining,
        });
      }
    }
  }

  return {
    violations,
    unresolved,
    uselessAnnotations,
    staleDebt: debt.filter((d) => !debtHits.has(d)),
    stalePalette: palette.filter((p) => !paletteHits.has(p)),
    tokenFailures: checkTokenInvariants(css),
    checked,
  };
}

function main() {
  const css = readFileSync(join(ROOT, CSS_PATH), "utf8");
  const files = SCAN_DIRS.flatMap((dir) =>
    walk(join(ROOT, dir)).map((full) => ({
      path: relative(ROOT, full).split(sep).join(sep),
      source: readFileSync(full, "utf8"),
    })),
  );

  const r = findViolations({ css, files });

  if (r.checked === 0) {
    console.error(
      "check-contrast: matched ZERO small-text colour utilities. The scanner is " +
        "broken or the scan dirs moved — a gate that sees nothing passes everything.",
    );
    process.exit(1);
  }

  for (const v of r.violations) {
    console.error(`\n${v.path}:${v.line}  text-ih-${v.token} at ${v.size}px`);
    console.error(`  ${v.snippet}`);
    console.error(`  surface ${v.surface} (${v.origin})`);
    for (const f of v.failures) {
      console.error(
        `  ${f.theme}: ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1)`,
      );
    }
  }
  for (const a of r.uselessAnnotations) {
    console.error(`\n${a.path}:${a.line}  contrast-surface: bg-ih-${a.token} is not needed`);
    console.error(`  ${a.snippet}`);
    console.error("  This site clears AA without it. Delete the annotation.");
  }
  for (const d of r.staleDebt) {
    console.error(`\nStale KNOWN_DEBT entry — no longer matches ${d.file}:`);
    console.error(`  ${d.match}\n  Remove it from scripts/check-contrast.mjs.`);
  }
  for (const t of r.tokenFailures) {
    console.error(
      `\nToken invariant broken — ${t.fg} on ${t.bg} (${t.theme}): ` +
        (t.ratio === null
          ? `one side is not a hex colour (${t.fgHex} / ${t.bgHex}).`
          : `${t.fgHex} on ${t.bgHex} = ${t.ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1).`),
    );
    console.error(`  ${t.why}`);
  }
  for (const p of r.stalePalette) {
    console.error(
      `\nStale PALETTE_DEBT entry — ${p.fg} on ${p.bg} (${p.theme}) is no longer ` +
        `a failure measuring ${p.ratio}:1.`,
    );
    console.error("  The palette moved. Re-take the decision, then update or remove the entry.");
  }

  // Printed on every run, pass or fail. A skipped site is not a checked site,
  // and the only thing worse than a gate that misses something is a gate that
  // misses it silently. `bg-ih-… is not in the @theme block` in particular is
  // never benign: that class compiles to nothing at all, so the element paints
  // no background and Tailwind says nothing about it.
  if (r.unresolved.length) {
    const tally = new Map();
    for (const u of r.unresolved) tally.set(u.why, (tally.get(u.why) ?? 0) + 1);
    console.log("check-contrast: surfaces skipped as unresolvable —");
    for (const [why, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${why}`);
  }

  const bad =
    r.violations.length +
    r.staleDebt.length +
    r.stalePalette.length +
    r.uselessAnnotations.length +
    r.tokenFailures.length;
  if (bad > 0) {
    console.error(
      `\n✖ check-contrast: ${r.violations.length} contrast failure(s), ` +
        `${r.tokenFailures.length} broken token invariant(s), ` +
        `${r.uselessAnnotations.length} unnecessary annotation(s), ` +
        `${r.staleDebt.length + r.stalePalette.length} stale exemption(s).`,
    );
    console.error(
      `  Small helper text must clear ${AA_NORMAL}:1 on the surface it is drawn on. ` +
        "For hints on a card that means text-ih-fg-3 (not fg-4); on bg-ih-bg-muted " +
        "even fg-3 is only 4.34:1, so use text-ih-fg-2 there.",
    );
    process.exit(1);
  }
  console.log(
    `✓ check-contrast: ${r.checked} small-text colour(s) clear ${AA_NORMAL}:1 in ` +
      `${THEMES.length} themes, plus ${TOKEN_INVARIANTS.length} token invariant(s) ` +
      `(${KNOWN_DEBT.length} site exemption(s), ${PALETTE_DEBT.length} palette ` +
      `exemption(s), ${r.unresolved.length} surface(s) the scanner could not ` +
      "resolve and did not check).",
  );
  console.log(
    "  Not covered, and not coverable here: a TENANT's brand colour. It lives in " +
      "the database, arrives as an inline style at request time, and never appears " +
      "in this stylesheet — so 63.6% of sRGB, the share that fails AA as brand-" +
      "coloured text on white, is invisible to every static gate. That share is " +
      "held by app/lib/brand.ts (`brandTextColor`) and pinned by a property test " +
      "over the sRGB cube in app/lib/brand.test.ts. A green run here says nothing " +
      "about it.",
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join("/"))) main();
