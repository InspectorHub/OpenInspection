/**
 * Shared money helpers for the render/editor edge. Storage + computation stay in
 * integer cents (see server/lib/pca-costs.ts, repair_request_items.requested_credit_cents);
 * these convert to/from a user-facing `$` string only at the UI boundary.
 * Extracted from RepairBuilderSection.tsx / repair-request.$shareToken.tsx so the
 * Repair Request Builder and the Commercial PCA cost engine format money identically.
 */

/** Integer cents -> `$X,XXX.XX` (en-US, two decimals, thousands separators). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** User dollar string -> integer cents. Empty / non-numeric -> null. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const dollars = Number.parseFloat(trimmed);
  if (Number.isNaN(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Integer cents -> a `$`-prefixed dollar string that shows cents ONLY when the
 * amount has them: `$8,500` for a whole-dollar estimate, `$8,500.50` when cents
 * were entered. The Commercial PCA Opinion-of-Cost convention is whole dollars,
 * so the common case never carries a redundant `.00`, but any cents the user
 * enters are preserved. Storage stays in integer cents.
 */
export function formatDollars(cents: number): string {
  const hasCents = cents % 100 !== 0;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Currency user input -> integer cents. Tolerates a `$` prefix, thousands
 * commas, and surrounding spaces, and accepts an optional decimal — the user
 * can type `8500`, `8,500`, or `$8,500.50`. Empty / non-numeric -> null.
 */
export function parseCurrencyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const dollars = Number.parseFloat(cleaned);
  if (Number.isNaN(dollars)) return null;
  return Math.round(dollars * 100);
}
