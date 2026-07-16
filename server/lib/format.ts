/**
 * Server-side twin of app/lib/format.ts. The app<->server import boundary forbids
 * importing app/ from server/, so this duplicates the (pure `Intl`) formatter for
 * email/PDF/API rendering. The two files MUST stay identical in behavior — a
 * parity test (tests/unit/platform/format-parity.spec.ts) asserts byte-identical
 * output across sample inputs so drift fails the build, not a human review.
 *
 * Server callers resolve the RECIPIENT's effective locale/timeZone/currency
 * (recipient user override -> tenant default) before formatting; never assume the
 * acting inspector's locale for client-facing output.
 */

export type DateInput = string | number | Date | null | undefined;

/** Normalize input to a Date. Bare YYYY-MM-DD is anchored at UTC midnight (a
 *  civil date, no zone); everything else is parsed as-is. null on invalid. */
function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const civil = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = value instanceof Date ? value : new Date(civil ? `${value}T00:00:00.000Z` : value);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(
  value: DateInput,
  opts: { locale: string; timeZone?: string; month?: "short" | "long" },
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(opts.locale, {
    year: "numeric",
    month: opts.month ?? "short",
    day: "numeric",
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(d);
}

export function formatTime(
  value: DateInput,
  opts: { locale: string; timeZone?: string; timeZoneName?: "short" | "long" },
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(opts.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(opts.timeZone
      ? { timeZone: opts.timeZone, ...(opts.timeZoneName ? { timeZoneName: opts.timeZoneName } : {}) }
      : {}),
  }).format(d);
}

export function formatDateTime(value: DateInput, opts: { locale: string; timeZone?: string }): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(opts.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(opts.timeZone ? { timeZone: opts.timeZone, timeZoneName: "short" } : {}),
  }).format(d);
}

export function formatNumber(n: number, opts: { locale: string }): string {
  return new Intl.NumberFormat(opts.locale).format(n);
}

/** Integer cents -> localized currency string, symbol form (`$1,234.50`). */
export function formatCurrency(cents: number, opts: { locale: string; currency: string }): string {
  return new Intl.NumberFormat(opts.locale, {
    style: "currency",
    currency: opts.currency,
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);
}
