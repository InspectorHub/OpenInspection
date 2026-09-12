/**
 * Palette-level policy for `scripts/check-contrast.mjs`: what the reference
 * surface is, which colour PAIRS are knowingly below AA, and which token
 * values must clear it whether or not anyone uses them yet.
 *
 * Split from the gate because the two answer different questions. The gate
 * asks "what did this call site write"; everything here asks "what is this
 * token WORTH", which needs no JSX at all — only the stylesheet.
 */
import {
  AA_NORMAL,
  THEMES,
  contrastRatio,
  resolveVar,
  aliasMap,
  aliasFallbacks,
} from "./contrast-css.mjs";

/**
 * The floor below which text SIZE stops mattering.
 *
 * WCAG AA asks 4.5:1 of normal text and 3:1 of large text (>=18.66px bold /
 * 24px). A pairing under 3:1 therefore fails at EVERY size, which is what makes
 * it checkable without knowing the size — and not knowing the size is the
 * scanner's most common reason for declining to look.
 */
export const AA_LARGE = 3;

/** The surface used when an element does not name one. */
export const REFERENCE_SURFACE = "--ih-bg-card";

/**
 * Real AA failures that belong to the PALETTE, not to a call site.
 *
 * Empty, and that is the interesting state. It held three entries accounting
 * for ~200 reports, all of them two token values: light `--ih-primary` was
 * `#6366f1` (4.47:1 on the white card — 0.03 short, and symmetric, so the same
 * number governed an indigo link AND white label text on a filled indigo
 * button), and light `--ih-status-bad` was `#ef4444` (white on it, 3.76:1).
 * Both were repaired in the palette — `#6265f0` (4.53) and `#dc2626` (4.83) —
 * so nothing is being tolerated here any more.
 *
 * Entries pin the MEASURED ratio. If the palette moves — fixed or worsened —
 * the entry stops matching and the gate fails, so the decision gets retaken
 * instead of inherited.
 */
export const PALETTE_DEBT = [];

/**
 * Invariants about TOKEN VALUES, checked whether or not any call site happens
 * to use them at a small size.
 *
 * The gate proper is call-site-driven: it finds a class string, resolves a
 * surface, measures. That makes it silent about a token nobody has adopted
 * yet — and `--ih-primary-text` was born exactly that way. A token whose whole
 * reason for existing is "this one is guaranteed readable" has to be checked
 * against its own promise directly, or the promise lasts only as long as
 * someone remembers it.
 */
export const TOKEN_INVARIANTS = [
  {
    fg: "--ih-primary-text",
    bg: REFERENCE_SURFACE,
    themes: ["light", "dark", "field"],
    why:
      "The brand-as-TEXT token. `--ih-primary` may be any tenant hex and is the " +
      "FILL; this one is derived (app/lib/brand.ts `brandTextColor`) so links and " +
      "brand-coloured labels clear AA. The three values here are the platform " +
      "defaults, which must satisfy the promise the derivation makes at runtime.",
  },
  {
    fg: "--ih-primary-fg",
    bg: "--ih-primary",
    themes: ["light", "dark", "field"],
    why:
      "The on-FILL foreground for `bg-ih-primary`. `--ih-primary` is per-theme " +
      "(#6265f0 light, #818cf8 dark and field), so a single fixed value can only " +
      "be right for one of them: white is 4.53:1 on the light fill and 2.98:1 on " +
      "the dark one. This token shipped declared NOWHERE, surviving only as the " +
      "`#ffffff` fallback inside the @theme alias, which is how the dark and " +
      "field primary buttons rendered white-on-light. brandTokens() overrides it " +
      "per tenant by measured ratio; these are the platform defaults it falls " +
      "back to, and they have to satisfy the same promise.",
  },
  {
    fg: "--ih-fg-inverse",
    bg: "--ih-status-bad",
    themes: ["light", "dark", "field"],
    why:
      "The destructive-button pairing that motivated moving light --ih-status-bad " +
      "to #dc2626. Five buttons put the inverse foreground on this fill and most " +
      "write `text-white`, which no call-site rule can see. All three themes, " +
      "because --ih-fg-inverse flips: white in light (wants the darker red), " +
      "near-black in dark/field (wants the lighter one). Darkening the token for " +
      "light alone regressed dark from 4.74:1 to 3.70:1 — this caught it.",
  },
];

/**
 * Every `@theme` alias must point at a custom property that is DECLARED.
 *
 * This is the check whose absence made the whole gate silent about
 * `--color-ih-primary-fg: var(--ih-primary-fg, #ffffff)`. `--ih-primary-fg` was
 * never declared in any theme block — only injected at request time by
 * `brandTokens()` for a tenant that has a brand colour — so:
 *
 *   - `resolveVar` returned null for all three themes;
 *   - `contrastRatio(null, …)` returned null;
 *   - the gate's per-theme loop read null as "not measurable" and `continue`d.
 *
 * Every `text-ih-primary-fg` call site was therefore skipped without being
 * counted, while the browser happily painted the `#ffffff` fallback — 4.53:1 on
 * the light primary and 2.98:1 on the dark/field one. A missing declaration is
 * not a measurement problem, it is a defect: one fixed fallback cannot be right
 * for three themes. So it is checked here, before any arithmetic.
 *
 * `rgba(…)` values are fine — those are declared, just not hex, and the gate
 * reports them as unresolvable surfaces. Only an ABSENT declaration fails.
 */
export function checkAliasDefinitions(css) {
  const alias = aliasMap(css);
  const fallbacks = aliasFallbacks(css);
  const out = [];
  for (const [name, prop] of alias) {
    const missing = THEMES.filter((_, i) => resolveVar(css, i, prop) === null).map((t) => t.name);
    if (missing.length) out.push({ name, prop, themes: missing, fallback: fallbacks.get(name) ?? null });
  }
  return out;
}

/** Measures TOKEN_INVARIANTS against the stylesheet. Returns failure records. */
export function checkTokenInvariants(css, invariants = TOKEN_INVARIANTS) {
  const out = [];
  for (const inv of invariants) {
    for (const theme of inv.themes) {
      const i = THEMES.findIndex((t) => t.name === theme);
      const fgHex = resolveVar(css, i, inv.fg);
      const bgHex = resolveVar(css, i, inv.bg);
      const ratio = contrastRatio(fgHex, bgHex);
      if (ratio === null || ratio < AA_NORMAL) {
        out.push({ ...inv, theme, ratio, fgHex, bgHex });
      }
    }
  }
  return out;
}
