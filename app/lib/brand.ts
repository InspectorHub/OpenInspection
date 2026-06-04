import type { CSSProperties } from "react";

/**
 * A-10 — tenant brand shared by every public surface (profile / booking /
 * report / invoice). Nullable fields mean "tenant hasn't set it": a null
 * primaryColor keeps the platform design tokens untouched.
 */
export interface TenantBrand {
  siteName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
}

export const EMPTY_BRAND: TenantBrand = { siteName: null, primaryColor: null, logoUrl: null };

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
  } as CSSProperties;
}
