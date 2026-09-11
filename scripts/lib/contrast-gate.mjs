/**
 * The measuring half of `scripts/check-contrast.mjs`.
 *
 * Split out for the file-size gate, along a seam that was already there: this
 * file decides what FAILS, `contrast-report.mjs` decides how that is printed,
 * and `check-contrast.mjs` is the CLI that walks the tree and wires the two.
 * Nothing here writes to the console, so every function is callable from a spec
 * with a synthetic stylesheet and synthetic files.
 *
 * The reasoning about WHAT is and is not covered lives in the CLI's header, next
 * to the gate's name, because that is where a reader looks first.
 */
import {
  classChunks,
  smallestSize,
  foregroundTokens,
  surfaceAnnotations,
  resolveSurface,
} from "./contrast-scan.mjs";
import {
  AA_NORMAL,
  THEMES,
  contrastRatio,
  resolveVar,
  parseHex,
  aliasMap,
  cssTextRules,
} from "./contrast-css.mjs";
import {
  AA_LARGE,
  REFERENCE_SURFACE,
  PALETTE_DEBT,
  checkTokenInvariants,
  checkAliasDefinitions,
} from "./palette-invariants.mjs";

/** Anything at or below this renders as normal text for AA purposes. */
export const MAX_SMALL_PX = 14;

/**
 * Real AA failures at ONE call site that are deliberately not fixed, each with
 * the measured ratio. These are debt, not approvals. `match` must still be
 * found in `file`, otherwise the gate fails.
 */
export const KNOWN_DEBT = [
  {
    // A REAL failure, recorded rather than repaired, and for a scheduling reason
    // rather than a design one: `text-ih-fg-4` at 12px on the card is 2.56:1 in
    // light and 3.07:1 in dark. The fix is the same one-token change applied at
    // the other 30 sites in this sweep — `text-ih-fg-3` (4.76 / 5.71 / 12.02) —
    // and it was left out only because `app/routes/agent/` was being edited
    // concurrently by another agent when this gate was extended. Not an approval.
    // The staleness guard retires this entry the moment the line is fixed.
    file: "app/routes/agent/settings-profile.tsx",
    match: 'tzError ? "text-ih-bad-fg" : "text-ih-fg-4"',
    ratio: { light: 2.56, dark: 3.07 },
  },
];

/** Path comparison that survives the separator differing between Windows and CI. */
const samePath = (a, b) => a.split(/[\\/]/).join("/") === b.split(/[\\/]/).join("/");

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
  const unmeasurable = [];
  const sizeless = [];
  const uselessAnnotations = [];
  const debtHits = new Set();
  const paletteHits = new Set();
  let checked = 0;
  let fromContext = 0;

  const hexCache = new Map();
  const hexes = (prop) => {
    if (!hexCache.has(prop)) {
      hexCache.set(prop, THEMES.map((_, i) => resolveVar(css, i, prop)));
    }
    return hexCache.get(prop);
  };

  for (const { path, source } of files) {
    const annotations = surfaceAnnotations(source);
    // For matching KNOWN_DEBT. A violation's chunk may now be a FRAGMENT from
    // inside a `${…}`, so a `match` written against the surrounding ternary is no
    // longer inside the chunk — the source line is where that text still lives,
    // and it stays a content match rather than a line-number key, so an edit
    // above it cannot silently re-point the exemption at different code.
    const sourceLines = source.split(/\r?\n/);
    for (const { text, line, context } of classChunks(source)) {
      const tokens = foregroundTokens(text);
      if (tokens.length === 0) continue;

      // A fragment inside `${…}` carries the colour; the size is usually in the
      // template around it. Borrowing it is sound in a way an ancestor walk is
      // not: both literals are concatenated into ONE class attribute, so the
      // template's `text-[10px]` really does apply to this fragment's colour.
      const ownSize = smallestSize(text);
      const size = ownSize ?? (context ? smallestSize(context) : null);
      if (size === null) {
        sizeless.push({ path, line, tokens, snippet: text.trim() });
        continue;
      }
      if (size > MAX_SMALL_PX) continue;
      if (ownSize === null) fromContext++;

      const annotation = annotations.get(line) ?? null;
      let surface = surfaceOf(text, alias, annotation);
      // Same concatenation argument for the surface: `bg-ih-bg-muted` written in
      // the ternary branch next to this one is on the same element.
      if (!annotation && context && surface.origin === "default") {
        const outer = surfaceOf(context, alias, null);
        if (outer.unresolved || outer.origin === "element") surface = outer;
      }
      if (surface.unresolved) {
        unresolved.push({ path, line, why: surface.unresolved, snippet: text.trim() });
        continue;
      }
      // A hex annotation names one colour for every theme; a token names three.
      const bgHexes = surface.hex ? THEMES.map(() => surface.hex) : hexes(surface.prop);
      const surfaceName = surface.hex ?? surface.prop;

      // What the surface would have been WITHOUT the annotation. An annotation
      // earns its place by changing the verdict; one that does not is a
      // suppression waiting to outlive its reason, so it is reported.
      // Only when the annotation was actually USED. An annotation covers a whole
      // line, so a ternary's other branch may have won on its own background —
      // that is not an idle annotation, it is one doing its job next door.
      const fallback =
        annotation && surface.origin === "annotation" ? surfaceOf(text, alias, null) : null;
      const fallbackHexes =
        fallback && !fallback.unresolved && fallback.prop ? hexes(fallback.prop) : null;

      for (const token of tokens) {
        const prop = alias.get(token);
        if (!prop) continue; // not a colour alias — lint:ds owns that
        checked++;
        const fgHexes = hexes(prop);
        const failures = [];
        for (let i = 0; i < THEMES.length; i++) {
          const ratio = contrastRatio(fgHexes[i], bgHexes[i]);
          if (ratio === null) {
            // Not measurable: one side is rgba, or — the case that hid F33 —
            // resolves to NOTHING. Counted and printed, never silent. An absent
            // declaration is caught outright by checkAliasDefinitions.
            unmeasurable.push({
              path,
              line,
              token,
              theme: THEMES[i].name,
              fg: fgHexes[i] ?? `${prop} is not declared`,
              bg: bgHexes[i] ?? `${surfaceName} is not declared`,
            });
            continue;
          }
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
              p.bg === surfaceName &&
              p.theme === f.theme &&
              Math.abs(p.ratio - f.ratio) < RATIO_EPSILON,
          );
          if (hit) paletteHits.add(hit);
          return !hit;
        });
        if (remaining.length === 0) continue;

        const haystack = [text, context ?? "", sourceLines[line - 1] ?? ""].join("\n");
        const excused = debt.find((d) => samePath(d.file, path) && haystack.includes(d.match));
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
          surface: surfaceName,
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
    unmeasurable,
    sizeless,
    uselessAnnotations,
    staleDebt: debt.filter((d) => !debtHits.has(d)),
    stalePalette: palette.filter((p) => !paletteHits.has(p)),
    tokenFailures: checkTokenInvariants(css),
    aliasFailures: checkAliasDefinitions(css),
    cssRules: findCssRuleViolations(css),
    checked,
    fromContext,
  };
}

/**
 * The stylesheet's own rules, measured.
 *
 * A rule with a px size <= MAX_SMALL_PX is held to AA_NORMAL. A rule whose size
 * nothing declares is held to AA_LARGE instead — below 3:1 no size can rescue
 * the pairing, so the verdict does not depend on the thing we could not read.
 * Everything else is reported as skipped, with the reason.
 */
export function findCssRuleViolations(css) {
  const failures = [];
  const skipped = [];
  let checked = 0;
  for (const rule of cssTextRules(css)) {
    const bgProp = rule.bg ?? REFERENCE_SURFACE;
    const threshold = rule.sizePx === null ? AA_LARGE : AA_NORMAL;
    if (rule.sizePx !== null && rule.sizePx > MAX_SMALL_PX) {
      skipped.push({ ...rule, why: `font-size ${rule.sizePx}px is larger than ${MAX_SMALL_PX}px` });
      continue;
    }
    let measured = 0;
    for (const [i, theme] of THEMES.entries()) {
      const fgHex = resolveVar(css, i, rule.fg);
      const bgHex = resolveVar(css, i, bgProp);
      const ratio = contrastRatio(fgHex, bgHex);
      if (ratio === null) {
        skipped.push({
          ...rule,
          bgProp,
          why: `${theme.name}: not a hex pair (${fgHex ?? "undeclared"} / ${bgHex ?? "undeclared"})`,
        });
        continue;
      }
      measured++;
      if (ratio < threshold) {
        failures.push({ ...rule, bgProp, theme: theme.name, fgHex, bgHex, ratio, threshold });
      }
    }
    if (measured) checked++;
  }
  return { failures, skipped, checked };
}

