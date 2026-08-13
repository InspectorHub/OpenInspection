import type { CSSProperties } from "react";
import type { DateFormat, TimeFormat } from "../../server/lib/session/display-prefs";

/**
 * A-10 — tenant brand shared by every public surface (profile / booking /
 * report / invoice). Nullable fields mean "tenant hasn't set it": a null
 * primaryColor keeps the platform design tokens untouched.
 */
export interface TenantBrand {
  companyName: string | null;
  /** Registered legal entity, ALREADY RESOLVED — never re-apply the fallback. */
  legalName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  /** Tenant display timezone (IANA; 'UTC' when unset). Public/report surfaces
   *  anchor displayed inspection dates to this zone. */
  defaultTimezone: string;
  /** #270 — the tenant's display language and date/time shape. A public page
   *  has no viewer to override them, and an inspection date must read the same
   *  to the inspector, the client and the agent, so these are tenant values. */
  defaultLocale: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** IA-36 ⑨ — client-facing recovery channels, null until the tenant sets
   *  them. A dead-link page needs somewhere to send the reader; naming the
   *  company without a way to reach it only says who to blame. */
  supportEmail: string | null;
  companyPhone: string | null;
  /** Effective Privacy / Terms URLs for footers (hosted or custom). */
  privacyUrl: string | null;
  termsUrl: string | null;
}

export const EMPTY_BRAND: TenantBrand = {
  companyName: null,
  legalName: "",
  primaryColor: null,
  logoUrl: null,
  defaultTimezone: "UTC",
  defaultLocale: "en-US",
  dateFormat: "us",
  timeFormat: "12h",
  supportEmail: null,
  companyPhone: null,
  privacyUrl: null,
  termsUrl: null,
};

/**
 * The date/time format bundle a PUBLIC surface renders with (#270).
 *
 * Public pages run in loaders, where the session hooks do not exist, and they
 * have no authenticated user to hold a personal override anyway. Everything
 * here is the tenant's — which is also what the design requires of an
 * inspection date: the client, the agent and the inspector must read the same
 * one out loud.
 */
export function brandFormat(brand: TenantBrand): {
  locale: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
} {
  return {
    locale: brand.defaultLocale,
    dateFormat: brand.dateFormat,
    timeFormat: brand.timeFormat,
  };
}

/* ───────────────────────── WCAG colour arithmetic ────────────────────────
 * Everything below answers "is this readable", which is a question about
 * RELATIVE LUMINANCE (WCAG 2.1 §1.4.3). It is NOT the question the old YIQ
 * perceived-brightness formula answered: YIQ is an NTSC luma weighting, and a
 * threshold on it approximates readability well enough to be believable and
 * badly enough to be wrong 28.5% of the time. `#00ff00` scores YIQ 149.685 —
 * three tenths under the old 150 cut-off — and so was given WHITE text at
 * 1.37:1. Measure the ratio the standard defines, and that whole class of
 * near-threshold mistakes stops existing.
 */

/**
 * WCAG AA for normal-size text. Exported because the settings picker quotes it
 * back to the tenant (#91) — a warning that says "below AA" without saying what
 * AA is asks the reader to look it up, and one that hardcodes 4.5 in a
 * translatable string can drift away from the number the derivation uses.
 */
export const AA_NORMAL = 4.5;

type Rgb = [number, number, number];

/** `#rgb` / `#rrggbb`, leading `#` optional. Null for anything else. */
function parseColor(value: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value?.trim() ?? "");
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of an sRGB triple. */
function luminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio, 1..21. Symmetric in its arguments. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB -> HSL, with H in [0,1). Saturation/hue survive the round trip. */
function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hueToChannel(p: number, q: number, t: number): number {
  const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/** HSL -> sRGB, rounded to the 8-bit grid a hex literal can actually hold. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [h + 1 / 3, h, h - 1 / 3].map((t) => Math.round(hueToChannel(p, q, t) * 255)) as Rgb;
}

/** The dark half of the on-brand foreground pair (DS `--ih-fg-1`-ish near-black). */
const ON_BRAND_DARK = "#111827";
const ON_BRAND_LIGHT = "#ffffff";

/**
 * Pick a readable text color for content sitting ON the brand primary color —
 * the FILL role, where the tenant's exact hex is the background and only the
 * foreground is ours to choose.
 *
 * There are exactly two candidates (white and the near-black DS token), so
 * there is no reason to approximate: measure both real WCAG ratios and take
 * the larger. Accepts `#rgb`/`#rrggbb` (leading `#` optional); any unparseable
 * input falls back to white so a misconfigured brand color never renders
 * invisible text.
 *
 * This does NOT guarantee AA. For 6.7% of sRGB — mid-luminance colours like
 * `#9f66ae`, where white and near-black both land at 4.21:1 — no choice of
 * foreground clears 4.5:1 and the fill itself would have to move. Picking the
 * better of the two is the most this function can do; `app/lib/brand.test.ts`
 * pins that residual band so it cannot silently grow.
 */
export function contrastForeground(hex: string | null | undefined): string {
  return fillContrast(hex)?.foreground ?? ON_BRAND_LIGHT;
}

/** What a reader actually gets on a control filled with the brand colour. */
export interface FillContrast {
  /** The foreground `contrastForeground` will render — measured, not guessed. */
  foreground: string;
  /** WCAG ratio of that foreground against the fill, 1..21. */
  ratio: number;
  /** Whether that ratio clears AA for normal text. */
  meetsAA: boolean;
}

/**
 * Measure the best readability a FILL of this colour admits (#91).
 *
 * `contrastForeground` answers "which text colour" and throws the measurement
 * away; the settings picker needs the measurement itself, to tell the tenant
 * what their choice costs. Both answers come from this one function so the
 * number shown in the warning is, by construction, the number the button will
 * render — a second implementation could disagree with the first and neither
 * side would know.
 *
 * `null` for an unparseable colour: there is nothing to measure, and a warning
 * about a colour we could not read would be a guess.
 */
export function fillContrast(hex: string | null | undefined): FillContrast | null {
  const fill = parseColor(hex);
  if (!fill) return null;
  const onLight = contrastRatio(parseColor(ON_BRAND_LIGHT)!, fill);
  const onDark = contrastRatio(parseColor(ON_BRAND_DARK)!, fill);
  const dark = onDark > onLight;
  const ratio = dark ? onDark : onLight;
  return { foreground: dark ? ON_BRAND_DARK : ON_BRAND_LIGHT, ratio, meetsAA: ratio >= AA_NORMAL };
}

/**
 * The surfaces a brand-coloured piece of TEXT is drawn on, per theme. Both are
 * `--ih-bg-card` — the same reference surface `scripts/check-contrast.mjs`
 * scores every other token against, so the static gate and this runtime
 * derivation are answering the same question.
 *
 * The dark entry covers the `field` scheme too: field's card (`#0f172a`) is
 * DARKER than dark's (`#1e293b`), and for light-on-dark text a darker surface
 * can only raise the ratio. One derivation, both dark themes.
 */
export const BRAND_TEXT_SURFACE_LIGHT = "#ffffff";
export const BRAND_TEXT_SURFACE_DARK = "#1e293b";

/**
 * Derive a text-safe variant of the brand colour for the TEXT role.
 *
 * The fill role and the text role are different jobs. When a tenant says "this
 * is my brand colour" they mean the large areas — the button fill, the accent
 * bar — and `--ih-primary` keeps their exact hex for those. Nobody's brand is
 * defined by the exact hex of a hyperlink, and 63.6% of sRGB fails AA as link
 * text on white, so the text role gets its own token.
 *
 * Algorithm: convert to HSL and move ONLY the lightness, so hue and saturation
 * — the two things a reader recognises as "the brand" — survive untouched.
 * Direction follows the surface: on a light surface the text must get darker
 * (toward L=0), on a dark surface lighter (toward L=1), because contrast grows
 * with the luminance distance between text and background. Binary-search that
 * lightness axis for the value CLOSEST to the original that still clears
 * 4.5:1, then walk the last step or two on the 8-bit grid, because a hex
 * literal cannot hold the continuous answer and rounding can cross back under
 * the threshold. An endpoint always exists (black clears 21:1 on white, white
 * clears 14.3:1 on the dark card), so the search always terminates on a
 * passing colour. A colour that already clears is returned unchanged — which
 * is why, at the platform default, `--ih-primary-text` equals `--ih-primary`.
 */
export function brandTextColor(
  hex: string | null | undefined,
  surface: string = BRAND_TEXT_SURFACE_LIGHT,
): string {
  const bg = parseColor(surface) ?? parseColor(BRAND_TEXT_SURFACE_LIGHT)!;
  // A dark surface pushes the text toward white; a light one toward black.
  const lighten = luminance(bg) < 0.5;
  const color = parseColor(hex);
  if (!color) return lighten ? ON_BRAND_LIGHT : ON_BRAND_DARK;
  if (contrastRatio(color, bg) >= AA_NORMAL) return toHex(color);

  const [h, s, l0] = rgbToHsl(color);
  // Invariant: the endpoint away from l0 always clears, l0 itself never does.
  let lo = lighten ? l0 : 0;
  let hi = lighten ? 1 : l0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const passes = contrastRatio(hslToRgb(h, s, mid), bg) >= AA_NORMAL;
    if (lighten === passes) hi = mid;
    else lo = mid;
  }
  // Quantisation guard: the binary search ran on continuous lightness, the
  // answer has to land on the 8-bit grid. Step until the ROUNDED colour clears.
  let l = lighten ? hi : lo;
  for (let i = 0; i <= 256; i++) {
    const candidate = hslToRgb(h, s, l);
    if (contrastRatio(candidate, bg) >= AA_NORMAL) return toHex(candidate);
    l = lighten ? Math.min(1, l + 1 / 255) : Math.max(0, l - 1 / 255);
  }
  /* c8 ignore next -- unreachable: the endpoint always clears on both surfaces */
  return lighten ? ON_BRAND_LIGHT : ON_BRAND_DARK;
}

/**
 * Re-points the Design System 0523 primary tokens at the tenant's accent on a
 * surface root. Every existing `bg-ih-primary` / `text-ih-primary-text` /
 * `shadow-ih-focus` consumer downstream picks the brand up automatically —
 * no per-component class changes. Derived shades come from `color-mix()`
 * mirroring the stock ratios (tailwind.css `:root`).
 *
 * `--ih-primary` is the FILL role and stays the tenant's exact hex, so their
 * buttons and accent bars look like their brand. `--ih-primary-text` is the
 * TEXT role and is derived (see `brandTextColor`) — a separate token because a
 * colour that is fine as a 44px-tall button is, 63.6% of the time, illegible
 * as a hyperlink.
 *
 * Returns `{}` when no tenant color is set so the platform default applies.
 */
export function brandTokens(primaryColor: string | null | undefined): CSSProperties {
  if (!primaryColor) return {};
  const c600 = `color-mix(in srgb, ${primaryColor} 88%, #000)`;
  const c700 = `color-mix(in srgb, ${primaryColor} 76%, #000)`;
  const tint = `color-mix(in srgb, ${primaryColor} 10%, transparent)`;
  const glow = `color-mix(in srgb, ${primaryColor} 25%, transparent)`;
  // The TEXT role needs a different answer per theme — a light surface pushes
  // the colour darker, a dark surface pushes it lighter — and an inline style
  // cannot carry a media query or an attribute selector. `light-dark()` does
  // exactly this: it resolves against the element's computed `color-scheme`,
  // which tailwind.css already sets (`color-scheme: light` in `:root`,
  // `color-scheme: dark` in the dark/field group). So one declaration covers
  // every theme, including a mid-session theme switch, with no call-site change.
  const text = `light-dark(${brandTextColor(primaryColor, BRAND_TEXT_SURFACE_LIGHT)}, ${brandTextColor(primaryColor, BRAND_TEXT_SURFACE_DARK)})`;
  return {
    "--ih-primary": primaryColor,
    "--ih-primary-600": c600,
    "--ih-primary-700": c700,
    "--ih-primary-tint": tint,
    "--ih-primary-glow": glow,
    "--ih-primary-text": text,
    // Tailwind v4 `@theme` aliases (`--color-ih-primary: var(--ih-primary)`)
    // substitute their var() at :root (custom-property computed values are
    // resolved at the declaring element and inherit pre-resolved), so
    // re-pointing the base tokens on a descendant alone does nothing —
    // override the aliases the utilities actually consume too.
    "--color-ih-primary": primaryColor,
    "--color-ih-primary-600": c600,
    "--color-ih-primary-700": c700,
    "--color-ih-primary-tint": tint,
    "--color-ih-primary-glow": glow,
    "--color-ih-primary-text": text,
    "--shadow-ih-focus": `0 0 0 3px ${glow}`,
    // Readable foreground for text/icons sitting on the brand primary color.
    // A bright accent (e.g. yellow/lime) needs dark text; a deep accent needs
    // white. Buttons on `bg-ih-primary` read this via `var(--color-ih-primary-fg)`.
    "--ih-primary-fg": contrastForeground(primaryColor),
    "--color-ih-primary-fg": contrastForeground(primaryColor),
  } as CSSProperties;
}
