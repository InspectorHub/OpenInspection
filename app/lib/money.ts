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
