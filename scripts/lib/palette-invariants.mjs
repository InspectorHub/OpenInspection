/**
 * Palette-level policy for `scripts/check-contrast.mjs`: what the reference
 * surface is, which colour PAIRS are knowingly below AA, and which token
 * values must clear it whether or not anyone uses them yet.
 *
 * Split from the gate because the two answer different questions. The gate
 * asks "what did this call site write"; everything here asks "what is this
 * token WORTH", which needs no JSX at all — only the stylesheet.
 */
import { AA_NORMAL, THEMES, contrastRatio, resolveVar } from "./contrast-css.mjs";

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
