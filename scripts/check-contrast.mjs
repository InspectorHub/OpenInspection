#!/usr/bin/env node
/**
 * WCAG AA contrast guard for small text in the design-system components.
 *
 * Why this exists as a SEPARATE gate from `lint:ds`:
 * `check-ds-tokens.mjs` validates token NAMES — that UI code says
 * `text-ih-fg-4` instead of `text-slate-400`. It is completely blind to what
 * those tokens are WORTH. Five form controls (Input, Select, Textarea,
 * RadioGroup, RadioCardGroup) shipped their `hint` line as
 * `text-[11px] text-ih-fg-4`, which is 2.56:1 on a light card and 3.07:1 on a
 * dark one — against a 4.5:1 requirement — and `lint:ds` was green on all five
 * for as long as they existed. FileDropzone got the same line right
 * (`text-ih-fg-3`), which is what marks it as a copy-paste slip rather than a
 * design decision. A name check cannot tell those two apart; arithmetic can.
 *
 * What it checks: every class string in `packages/shared-ui/src` that sets BOTH
 * a small text size (<= MAX_SMALL_PX) and an unprefixed `text-ih-*` foreground
 * must clear 4.5:1 against the reference surface in EVERY theme the stylesheet
 * declares.
 *
 * The reference surface is `--ih-bg-card` (see REFERENCE_SURFACE). DS
 * components render inside cards, modals and drawers, so that is the surface
 * their small print actually sits on, and it is the surface the original defect
 * was measured against. This is an ASSUMPTION, stated deliberately: the same
 * text placed on `--ih-bg-muted` is dimmer still (light `--ih-fg-3` on muted is
 * only 4.34:1) and is out of scope here — a component that chooses a non-card
 * surface owns that choice.
 *
 * Size threshold: WCAG's "large text" exemption starts at 18.66px bold / 24px
 * regular. Everything this gate looks at is far below that, so the normal-text
 * 4.5:1 threshold is the right one and no bold/size exemption logic is needed.
 *
 * Escape hatch: KNOWN_DEBT below. Entries are matched against live code and a
 * stale entry FAILS the gate, so an exemption cannot outlive the line it
 * excuses.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIR = join("packages", "shared-ui", "src");
const CSS_PATH = join("app", "styles", "tailwind.css");

/** WCAG 2.1 AA, normal-size text. */
export const AA_NORMAL = 4.5;

/** Anything at or below this renders as normal text for AA purposes. */
export const MAX_SMALL_PX = 14;

/** The surface small DS text is assumed to sit on. See the header note. */
export const REFERENCE_SURFACE = "--ih-bg-card";

/**
 * Theme blocks in cascade order: `field` is declared inside the dark group and
 * overrides part of it, and both fall through to `:root`. Matching on the
 * SELECTOR LIST (not an exact selector) matters — dark is declared as a group
 * `html[...="dark"], html[...="field"], .dark { … }`, so searching for the
 * exact dark selector finds nothing and silently reads the light palette.
 */
export const THEMES = [
  { name: "light", marker: ":root" },
  { name: "dark", marker: 'data-color-scheme="dark"' },
  { name: "field", marker: 'data-color-scheme="field"' },
];

/**
 * Real AA failures that are deliberately NOT fixed here, each with the measured
 * ratio at the time of writing. These are debt, not approvals.
 *
 * `match` must still be found in `file`, otherwise the gate fails: an
 * exemption that no longer describes the code is worse than none.
 */
export const KNOWN_DEBT = [
  {
    file: join("packages", "shared-ui", "src", "Table.tsx"),
    match: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
    // 2.56:1 light / 3.07:1 dark — the same token, but this is the column
    // header of every table in the app rather than one field's hint line, and
    // `Table.test.tsx` pins the token. Changing it is a design decision with a
    // visual pass attached, not a copy-paste repair. Tracked with the hint fix.
    reason: "Table column header (#79) — global visual change, needs its own design pass",
  },
];

/* ────────────────────────────── colour maths ───────────────────────────── */

/** #rgb / #rrggbb -> [r,g,b] 0-255. Returns null for anything else. */
export function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(fgHex, bgHex) {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ───────────────────────────── stylesheet parse ─────────────────────────── */

/** Every declaration body whose selector list mentions `marker`, in order. */
function blocksFor(css, marker) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) if (m[1].includes(marker)) out.push(m[2]);
  return out;
}

/** A custom property's effective value in theme `i`, following the cascade. */
export function resolveVar(css, themeIndex, prop) {
  for (let i = themeIndex; i >= 0; i--) {
    const blocks = blocksFor(css, THEMES[i].marker);
    for (let b = blocks.length - 1; b >= 0; b--) {
      const hit = blocks[b].match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
      if (hit) return hit[1].trim();
    }
  }
  return null;
}

/**
 * `text-ih-<suffix>` -> the `--ih-*` custom property behind it, read from the
 * `@theme` alias block so a token rename cannot quietly defang this gate.
 */
export function aliasMap(css) {
  const map = new Map();
  const re = /--color-ih-([a-z0-9-]+)\s*:\s*var\(\s*(--ih-[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) map.set(m[1], m[2]);
  return map;
}

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

/* ───────────────────────────── source scanning ──────────────────────────── */

const NAMED_SIZES = { "text-xs": 12, "text-sm": 14, "text-base": 16, "text-lg": 18 };

/** Smallest text size a class string sets, in px, or null if it sets none. */
export function smallestSize(chunk) {
  const found = [];
  for (const [util, px] of Object.entries(NAMED_SIZES)) {
    if (new RegExp(`(?<![-:\\w])${util.replace("[", "\\[")}(?![\\w-])`).test(chunk)) found.push(px);
  }
  for (const m of chunk.matchAll(/(?<![-:\w])text-\[(\d+(?:\.\d+)?)px\]/g)) found.push(Number(m[1]));
  return found.length ? Math.min(...found) : null;
}

/**
 * Unprefixed `text-ih-*` foregrounds in a class string. Variant-prefixed
 * utilities (`hover:`, `placeholder:`, `print:`) are skipped — a placeholder or
 * a hover tint is not the resting state of body copy.
 */
export function foregroundTokens(chunk) {
  return [...chunk.matchAll(/(?<![-:\w])text-ih-([a-z0-9-]+)(?![\w-])/g)].map((m) => m[1]);
}

/**
 * Blank out comments, preserving line count.
 *
 * Not cosmetic: these files are heavily commented in prose, and an apostrophe
 * in `the card's overflow` opens a phantom string literal that swallows
 * everything up to the next quote — including, potentially, a real class
 * string, which would then never be checked. The first version of this scanner
 * reported Table.tsx's header at line 8 instead of 33 for exactly that reason.
 */
export function stripComments(source) {
  const keepLines = (s) => s.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, keepLines)
    // `(?<!:)` keeps `https://…` inside a string from being treated as a comment.
    .replace(/(?<!:)\/\/[^\n]*/g, keepLines);
}

/** Quoted/backticked string literals in a source file, with 1-based lines. */
export function classChunks(source) {
  const out = [];
  const scannable = stripComments(source);
  const re = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(scannable)) !== null) {
    const body = m[2].replace(/\$\{[\s\S]*?\}/g, " ");
    if (!body.includes("text-")) continue;
    out.push({ text: body, line: scannable.slice(0, m.index).split("\n").length });
  }
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

/* ─────────────────────────────── the gate ───────────────────────────────── */

/**
 * Pure core. `files` is `[{ path, source }]`; `css` is the stylesheet text.
 * Returns `{ violations, staleDebt, checked }`.
 */
export function findViolations({ css, files, debt = KNOWN_DEBT }) {
  const alias = aliasMap(css);
  const bgs = surfaces(css);
  const violations = [];
  const debtHits = new Set();
  let checked = 0;

  for (const { path, source } of files) {
    for (const { text, line } of classChunks(source)) {
      const size = smallestSize(text);
      if (size === null || size > MAX_SMALL_PX) continue;
      const tokens = foregroundTokens(text);
      if (tokens.length === 0) continue;

      for (const token of tokens) {
        const prop = alias.get(token);
        if (!prop) continue; // not a colour alias (e.g. text-ih-... typo) — lint:ds owns that
        checked++;
        const failures = [];
        for (let i = 0; i < bgs.length; i++) {
          const fgHex = resolveVar(css, i, prop);
          const ratio = contrastRatio(fgHex, bgs[i].hex);
          if (ratio === null) continue; // non-hex (rgba tint) — not a text colour
          if (ratio < AA_NORMAL) {
            failures.push({ theme: bgs[i].theme, fg: fgHex, bg: bgs[i].hex, ratio });
          }
        }
        if (failures.length === 0) continue;

        const excused = debt.find((d) => d.file === path && text.includes(d.match));
        if (excused) {
          debtHits.add(excused);
          continue;
        }
        violations.push({ path, line, size, token, prop, snippet: text.trim(), failures });
      }
    }
  }

  const staleDebt = debt.filter((d) => !debtHits.has(d));
  return { violations, staleDebt, checked };
}

function main() {
  const css = readFileSync(join(ROOT, CSS_PATH), "utf8");
  const files = walk(join(ROOT, SCAN_DIR)).map((full) => ({
    path: relative(ROOT, full).split(sep).join(sep),
    source: readFileSync(full, "utf8"),
  }));

  const { violations, staleDebt, checked } = findViolations({ css, files });

  if (checked === 0) {
    console.error(
      "check-contrast: matched ZERO small-text colour utilities. The scanner is " +
        "broken or the scan dir moved — a gate that sees nothing passes everything.",
    );
    process.exit(1);
  }

  for (const v of violations) {
    console.error(`\n${v.path}:${v.line}  text-ih-${v.token} at ${v.size}px`);
    console.error(`  ${v.snippet}`);
    for (const f of v.failures) {
      console.error(
        `  ${f.theme}: ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1)`,
      );
    }
  }
  for (const d of staleDebt) {
    console.error(`\nStale KNOWN_DEBT entry — no longer matches ${d.file}:`);
    console.error(`  ${d.match}`);
    console.error("  Remove it from scripts/check-contrast.mjs.");
  }

  const bad = violations.length + staleDebt.length;
  if (bad > 0) {
    console.error(
      `\n✖ check-contrast: ${violations.length} contrast failure(s), ` +
        `${staleDebt.length} stale exemption(s).`,
    );
    console.error(
      `  Small helper text in shared-ui must clear ${AA_NORMAL}:1 on ${REFERENCE_SURFACE}. ` +
        "For hints, that means text-ih-fg-3 (not fg-4).",
    );
    process.exit(1);
  }
  console.log(
    `✓ check-contrast: ${checked} small-text colour(s) in ${SCAN_DIR} clear ` +
      `${AA_NORMAL}:1 in ${THEMES.length} themes (${KNOWN_DEBT.length} documented exemption(s)).`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join("/"))) main();
