import type { CSSProperties } from "react";

/**
 * A-10 — tenant brand shared by every public surface (profile / booking /
 * report / invoice). Nullable fields mean "tenant hasn't set it": a null
 * primaryColor keeps the platform design tokens untouched.
 */
export interface TenantBrand {
  companyName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
}

export const EMPTY_BRAND: TenantBrand = { companyName: null, primaryColor: null, logoUrl: null };

/**
 * Pick a readable text color for content sitting ON the brand primary color.
 * Uses the YIQ perceived-brightness formula: bright backgrounds (≥150) get the
 * dark token (#111827), everything else gets white. Accepts `#rgb`/`#rrggbb`
 * (leading `#` optional); any unparseable input falls back to white so a
 * misconfigured brand color never renders invisible text.
 */
export function contrastForeground(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111827" : "#ffffff";
}

/**
 * Re-points the Design System 0523 primary tokens at the tenant's accent on a
 * surface root. Every existing `bg-ih-primary` / `text-ih-primary` /
 * `shadow-ih-focus` consumer downstream picks the brand up automatically —
 * no per-component class changes. Derived shades come from `color-mix()`
 * mirroring the stock ratios (tailwind.css `:root`).
 *
 * Returns `{}` when no tenant color is set so the platform default applies.
 */
export function brandTokens(primaryColor: string | null | undefined): CSSProperties {
  if (!primaryColor) return {};
  const c600 = `color-mix(in srgb, ${primaryColor} 88%, #000)`;
  const c700 = `color-mix(in srgb, ${primaryColor} 76%, #000)`;
  const tint = `color-mix(in srgb, ${primaryColor} 10%, transparent)`;
  const glow = `color-mix(in srgb, ${primaryColor} 25%, transparent)`;
  return {
    "--ih-primary": primaryColor,
    "--ih-primary-600": c600,
    "--ih-primary-700": c700,
    "--ih-primary-tint": tint,
    "--ih-primary-glow": glow,
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
    "--shadow-ih-focus": `0 0 0 3px ${glow}`,
    // Readable foreground for text/icons sitting on the brand primary color.
    // A bright accent (e.g. yellow/lime) needs dark text; a deep accent needs
    // white. Buttons on `bg-ih-primary` read this via `var(--color-ih-primary-fg)`.
    "--ih-primary-fg": contrastForeground(primaryColor),
    "--color-ih-primary-fg": contrastForeground(primaryColor),
  } as CSSProperties;
}
