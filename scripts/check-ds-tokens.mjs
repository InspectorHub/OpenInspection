#!/usr/bin/env node
/**
 * Design System 0523 conformance guard.
 *
 * Fails (exit 1) when UI code bypasses the token layer with raw Tailwind
 * palette classes. Rules (see docs of the 2026-06-04 DS conformance
 * remediation, extended 2026-07 with the radius/spacing/scrim rules):
 *
 *   1. The dead `-bg0` pseudo-token (`ih-(ok|watch|bad|primary)-bg0`) —
 *      generates NO utility, ships invisible elements.
 *   2. Raw palette utilities (`bg-slate-200`, `text-indigo-600`, ...) —
 *      bypass dark mode and the brand hue.
 *   3. Literal `bg-white` / `bg-black` on in-app surfaces.
 *   4. Non-token shadows (`shadow-sm|md|lg|xl|2xl`) — DS defines exactly
 *      two elevations: `shadow-ih-card` and `shadow-ih-popover`.
 *   5. Arbitrary radius (`rounded-[10px]`) — use the semantic radii
 *      (`rounded-ih-button|input|card|modal|pill`).
 *   6. Arbitrary px padding/margin/gap/space (`p-[18px]`, `gap-[2px]`) —
 *      prefer the standard scale or the `ih-list`/`ih-card` spacing tokens.
 *      (width, height, inset and min-/max- dims are legit bespoke, not flagged.)
 *   7. `backdrop-blur` — glass blur is not part of the DS surface language.
 *   8. `bg-[rgba(...)]` scrims — use the single `bg-ih-backdrop` overlay
 *      token (fixed-dark studio/report surfaces excepted via ds-allow).
 *   9. An `ih-*` alias with NO `@theme` entry (see below).
 *
 * ── Rule 9: the alias has to actually resolve ──
 * Rules 1-8 ask whether a class name LOOKS like a token. Ask the other
 * question — what does an UNDEFINED token look like to this gate? — and the
 * answer, until this rule existed, was "exactly like a defined one".
 * `bg-ih-bg-input` (17 call sites), `bg-ih-status-watch-bg`, `text-ih-danger`,
 * `text-ih-fg-muted`, `bg-ih-surface`, `border-ih-line` and four others were
 * all green here for as long as they existed. Tailwind emits no CSS for a
 * theme value it cannot find and reports nothing, so those elements simply
 * painted no background / inherited a colour, in every theme, silently.
 *
 * So rule 9 reads the `@theme` block and requires every `ih-*` alias in the
 * source to have an entry there, in a namespace the utility can actually read
 * from: `bg-` and `text-` resolve against `--color-*`, `rounded-` against
 * `--radius-*`, `p-`/`mt-` against `--spacing-*`, and so on. `shadow-ih-card`
 * is fine and `bg-ih-card` is not, even though the NAME `ih-card` exists in
 * both `--shadow-*` and `--radius-*`.
 *
 * It has no escape hatch and it does not honour FILE_ALLOWLIST. Every other
 * rule here is a style preference that a fixed-dark surface can legitimately
 * break; this one reports code that does nothing at all, which no file has a
 * reason to want.
 *
 * Escape hatches:
 *   - A `ds-allow` comment on the offending line, or within the
 *     ALLOW_WINDOW lines above it (use for fixed-dark surfaces, print
 *     output, email bodies — always state the reason).
 *   - `print:`-variant utilities are ignored (print output is fixed-color
 *     by design).
 *   - Files in FILE_ALLOWLIST are skipped entirely.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = ["app", join("packages", "shared-ui", "src")];
const CSS_PATH = join("app", "styles", "tailwind.css");

/** Entire files exempt from all rules. Keep this list short and justified. */
const FILE_ALLOWLIST = [
  // Email bodies render in external clients with no dark mode / CSS vars.
  join("app", "components", "email-template", "EmailPreview.tsx"),
  // Full-screen photo-annotation studio: fixed-dark chrome in both themes,
  // styled with white-alpha glass utilities throughout. Brand fills inside
  // it ARE tokenized; the neutral on-dark styling is intentional.
  join("app", "components", "editor", "PhotoStudio.tsx"),
  // Media Studio react-konva annotator — same fixed-dark studio chrome as
  // PhotoStudio.tsx (its replacement); neutral on-dark styling is intentional.
  join("app", "components", "media-studio", "PhotoAnnotator.tsx"),
  // Extracted from PhotoAnnotator.tsx — same fixed-dark studio chrome.
  join("app", "components", "media-studio", "AnnotationToolbar.tsx"),
  join("app", "components", "media-studio", "MeasureCalibration.tsx"),
];

/** How many lines above a violation a `ds-allow` comment still excuses it. */
const ALLOW_WINDOW = 10;

const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIXES =
  "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|caret|accent|shadow|decoration";

// Arbitrary px padding/margin/gap/space. Longer alternatives first so the
// reported match is the full utility; word boundary keeps "top-[160px]" /
// "backdrop-[..]" / "max-w-[..]" (dimension utilities) out.
const SPACING_PREFIXES =
  "px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|gap-x|gap-y|gap|space-x|space-y";

const RULES = [
  { name: "dead -bg0 token", re: new RegExp(`ih-(ok|watch|bad|primary)-bg0`, "g") },
  { name: "raw palette class", re: new RegExp(`\\b(${PREFIXES})-(${HUES})-[0-9]`, "g") },
  { name: "literal bg-white/bg-black", re: /\bbg-(white|black)\b/g },
  { name: "non-token shadow", re: /\bshadow-(sm|md|lg|xl|2xl)\b/g },
  { name: "arbitrary radius", re: /\brounded-\[\d+px\]/g },
  { name: "arbitrary px spacing", re: new RegExp(`\\b(${SPACING_PREFIXES})-\\[\\d+px\\]`, "g") },
  { name: "backdrop-blur", re: /\bbackdrop-blur/g },
  { name: "rgba scrim", re: /\bbg-\[rgba\(/g },
  // `text-white` on a brand-primary fill bypasses the theme flip: dark mode
  // brightens --ih-primary to #818cf8 and flips --ih-fg-inverse to #0f172a
  // (dark-on-light ≈5.8:1; white would be ≈2.9:1 and fail AA). 95 sites had
  // hand-written white before this rule existed — hence a rule, not a review
  // note. Matches either order on the line; use text-ih-fg-inverse.
  {
    name: "text-white on bg-ih-primary (use text-ih-fg-inverse)",
    re: /\btext-white\b[^\n]*\bbg-ih-primary\b|\bbg-ih-primary\b[^\n]*\btext-white\b/g,
  },
];

/* ─────────────── rule 9: every `ih-*` alias resolves to a @theme entry ─────────────── */

/**
 * Which `@theme` namespace(s) a utility prefix reads its value from.
 *
 * A prefix absent from this table is checked against the union of every
 * namespace instead of being skipped: an unfamiliar prefix must not become a
 * hole, and "the name exists SOMEWHERE in @theme" is still a real check.
 */
const COLOR_UTILITIES = [
  "bg", "text", "border", "border-t", "border-b", "border-l", "border-r",
  "border-x", "border-y", "border-s", "border-e", "divide", "ring",
  "ring-offset", "outline", "from", "via", "to", "fill", "stroke",
  "placeholder", "caret", "accent", "decoration",
];
const RADIUS_UTILITIES = [
  "rounded", "rounded-t", "rounded-b", "rounded-l", "rounded-r",
  "rounded-tl", "rounded-tr", "rounded-bl", "rounded-br",
  "rounded-s", "rounded-e", "rounded-ss", "rounded-se", "rounded-es", "rounded-ee",
];
const SPACING_UTILITIES = [
  "p", "px", "py", "pt", "pb", "pl", "pr", "ps", "pe",
  "m", "mx", "my", "mt", "mb", "ml", "mr", "ms", "me",
  "gap", "gap-x", "gap-y", "space-x", "space-y",
  "w", "h", "size", "min-w", "max-w", "min-h", "max-h",
  "inset", "inset-x", "inset-y", "top", "right", "bottom", "left",
  "translate-x", "translate-y", "scroll-m", "scroll-p", "indent", "basis",
];

export const PREFIX_NAMESPACES = Object.fromEntries([
  ...COLOR_UTILITIES.map((p) => [p, ["color"]]),
  ...RADIUS_UTILITIES.map((p) => [p, ["radius"]]),
  ...SPACING_UTILITIES.map((p) => [p, ["spacing"]]),
  // `shadow-ih-card` is the elevation; `shadow-ih-primary` would be a colour.
  ["shadow", ["shadow", "color"]],
  ["drop-shadow", ["drop-shadow", "color"]],
  ["inset-shadow", ["inset-shadow", "color"]],
  ["text-shadow", ["text-shadow", "color"]],
  ["font", ["font"]],
  ["animate", ["animate"]],
  ["leading", ["leading"]],
  ["tracking", ["tracking"]],
]);
// `text-` is both a colour and a font-size utility, so it may read either.
PREFIX_NAMESPACES.text = ["color", "text"];

/**
 * A Tailwind utility whose value is an `ih-*` alias, e.g. `bg-ih-bg-card`.
 *
 * The lookbehind is what keeps a `--color-ih-primary` DECLARATION (brand.ts
 * writes those as inline style props) from being read as a `color-` utility.
 * Variant prefixes need no handling: `:` and `!` are outside the character
 * class, so `hover:bg-ih-primary` matches starting at `bg`.
 */
const IH_UTILITY = /(?<![-\w])([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-(ih-[a-z0-9-]+)/g;

/** `--<namespace>-<ih-name>` entries inside the `@theme` block(s). */
export function themeAliases(css) {
  const byNamespace = new Map();
  let idx = 0;
  for (;;) {
    const at = css.indexOf("@theme", idx);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    for (const m of css.slice(open + 1, i).matchAll(/--([a-z][a-z-]*?)-(ih-[a-z0-9-]+)\s*:/g)) {
      if (!byNamespace.has(m[1])) byNamespace.set(m[1], new Set());
      byNamespace.get(m[1]).add(m[2]);
    }
    idx = i;
  }
  return byNamespace;
}

/**
 * Pure core. `files` is `[{ path, source }]`, `css` the stylesheet text.
 * Returns `{ violations, checked }`; `checked` exists so a scan that matched
 * nothing cannot read as a pass.
 */
export function findUnresolvedAliases({ css, files }) {
  const defined = themeAliases(css);
  const everywhere = new Map(); // ih-name -> namespaces it IS defined in
  for (const [ns, names] of defined) {
    for (const n of names) everywhere.set(n, [...(everywhere.get(n) ?? []), ns]);
  }
  if (everywhere.size === 0) {
    throw new Error(
      "check-ds-tokens: the @theme block yielded no ih-* aliases. The stylesheet " +
        "moved or its shape changed — refusing to run, because a gate with an empty " +
        "reference set approves everything.",
    );
  }

  const violations = [];
  let checked = 0;
  for (const { path, source } of files) {
    source.split("\n").forEach((line, i) => {
      for (const [, prefix, name] of line.matchAll(IH_UTILITY)) {
        checked++;
        const namespaces = PREFIX_NAMESPACES[prefix] ?? null;
        const ok = namespaces
          ? namespaces.some((ns) => defined.get(ns)?.has(name))
          : everywhere.has(name);
        if (ok) continue;
        const elsewhere = everywhere.get(name);
        violations.push({
          path,
          line: i + 1,
          utility: `${prefix}-${name}`,
          why: elsewhere
            ? `no --${namespaces[0]}-${name} in @theme (the name exists as ` +
              `${elsewhere.map((ns) => `--${ns}-${name}`).join(", ")}; a \`${prefix}-\` ` +
              "utility cannot read that namespace)"
            : `${name} has no @theme entry at all — Tailwind emits no CSS for this class`,
        });
      }
    });
  }
  return { violations, checked };
}

/* ───────────────────────────────── runner ───────────────────────────────── */

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

function main() {
  const violations = [];
  const files = [];

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, scanDir))) {
      const rel = relative(ROOT, file);
      const source = readFileSync(file, "utf8");
      // Rule 9 covers the allowlist too — see the header note.
      files.push({ path: rel.split(sep).join("/"), source });
      if (FILE_ALLOWLIST.includes(rel)) continue;

      const lines = source.split("\n");
      lines.forEach((rawLine, i) => {
        // Strip print-variant utilities — fixed-color print output is sanctioned.
        const line = rawLine.replace(/\bprint:[\w[\]/.-]+/g, "");
        for (const rule of RULES) {
          rule.re.lastIndex = 0;
          const m = rule.re.exec(line);
          if (!m) continue;
          // ds-allow on the line itself or within the window above excuses it.
          const from = Math.max(0, i - ALLOW_WINDOW);
          const excused = lines.slice(from, i + 1).some((l) => l.includes("ds-allow"));
          if (!excused) {
            violations.push(`${rel.split(sep).join("/")}:${i + 1}  [${rule.name}]  ${m[0]}`);
          }
        }
      });
    }
  }

  const unresolved = findUnresolvedAliases({
    css: readFileSync(join(ROOT, CSS_PATH), "utf8"),
    files,
  });
  if (unresolved.checked === 0) {
    console.error(
      "check-ds-tokens: matched ZERO ih-* utilities across the scan dirs. The " +
        "scanner is broken or the directories moved.",
    );
    process.exit(1);
  }
  for (const v of unresolved.violations) {
    violations.push(`${v.path}:${v.line}  [undefined token]  ${v.utility} — ${v.why}`);
  }

  if (violations.length > 0) {
    console.error("Design System conformance check FAILED.\n");
    console.error(
      "Use semantic tokens (bg-ih-bg-card, text-ih-fg-2, border-ih-border, bg-ih-ok, shadow-ih-card/popover, " +
        "rounded-ih-button/card/pill, p-ih-list/ih-card spacing, bg-ih-backdrop scrim; no backdrop-blur).",
    );
    console.error(
      "For sanctioned exceptions (fixed-dark surfaces, print, email bodies) add a `ds-allow: <reason>` comment on or just above the line.\n",
    );
    console.error(
      "`[undefined token]` has no such exception: the class compiles to nothing. Either fix " +
        "the name, or add the token to the @theme block AND to :root, the dark block and the " +
        "field block in app/styles/tailwind.css.\n",
    );
    for (const v of violations) console.error("  " + v);
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    `DS token conformance: OK (${unresolved.checked} ih-* utilities resolved against @theme)`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join("/"))) main();
