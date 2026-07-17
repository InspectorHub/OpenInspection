/**
 * Shared money helpers for the render/editor edge. Storage + computation stay in
 * integer cents (see server/lib/pca-costs.ts, repair_request_items.requested_credit_cents);
 * these convert to/from a user-facing `$` string only at the UI boundary.
 * Extracted from RepairBuilderSection.tsx / repair-request.$shareToken.tsx so the
 * Repair Request Builder and the Commercial PCA cost engine format money identically.
 *
 * Currency rendering delegates to the shared locale-aware formatter (app/lib/format).
 * `locale`/`currency` are optional and default to en-US/USD so unmigrated callers
 * stay byte-identical; migrated call sites thread the viewer's effective values
 * (useDisplayLocale/useDisplayCurrency on the client, tenant defaults on the server).
 */

import { formatCurrency } from './format';

/** Optional locale/currency override; both default to en-US/USD. */
export type MoneyOpts = { locale?: string; currency?: string };

/** Integer cents -> `$X,XXX.XX` (defaults en-US/USD, two decimals, thousands separators). */
export function formatCents(cents: number, opts?: MoneyOpts): string {
  return formatCurrency(cents, { locale: opts?.locale ?? 'en-US', currency: opts?.currency ?? 'USD' });
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
export function formatDollars(cents: number, opts?: MoneyOpts): string {
  const formatted = formatCurrency(cents, { locale: opts?.locale ?? 'en-US', currency: opts?.currency ?? 'USD' });
  // Opinion-of-Cost convention is whole dollars: drop the redundant `.00` when
  // the amount has no cents; keep any cents the user actually entered.
  return cents % 100 === 0 ? formatted.replace(/\.00$/, '') : formatted;
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
