/**
 * Property/transaction grouping for the agent portal.
 *
 * An agent's unit of work is the deal, not the inspection company, so every
 * agent surface groups by property address first. The key normalizes casing and
 * whitespace so variants of the same address collapse together; an entry with no
 * address falls back to its own id, so addressless rows stay separate instead of
 * all merging into one "No address" bucket.
 *
 * Shared by the dashboard and the repair-items page — the two must agree, or the
 * agent sees the same deal split differently on two pages.
 */

/** Case/whitespace-insensitive address form used as the grouping identity. */
export function normalizeAddress(address: string | null | undefined): string {
  return (address ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Grouping key for one row; `fallbackId` keeps addressless rows distinct. */
export function propertyGroupKey(address: string | null | undefined, fallbackId: string): string {
  const normalized = normalizeAddress(address);
  return normalized ? `addr:${normalized}` : `insp:${fallbackId}`;
}

/**
 * Sortable timestamp for the mixed `inspections.date` column (full ISO or
 * YYYY-MM-DD). Missing / unparseable dates sort last.
 */
export function inspectionDateValue(date: string | null | undefined): number {
  if (!date) return -Infinity;
  const t = Date.parse(date);
  return Number.isNaN(t) ? -Infinity : t;
}
