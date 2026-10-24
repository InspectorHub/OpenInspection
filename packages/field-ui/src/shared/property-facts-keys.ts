// Client-safe (no server-only preset import). The single source of truth for
// which property-fact keys map to dedicated `inspections` columns vs. the
// property_facts JSON envelope. Must stay in sync with PropertyFactsSchema
// dedicated keys (server/lib/validations/inspection/read.ts).
export const DEDICATED_FACT_KEYS = [
  "yearBuilt",
  "sqft",
  "foundationType",
  "lotSize",
  "bedrooms",
  "bathrooms",
  "unit",
  "county",
  "reportTier",
  "commercialSubtype",
] as const;

const SET = new Set<string>(DEDICATED_FACT_KEYS);

// True when a property-fact key is backed by a dedicated `inspections` column.
// Everything else is a commercial subtype-preset field that persists into the
// property_facts JSON envelope (nra, floorCount, occupancyClass, sprinklered,
// gla, dockCount, ...). See design doc
// 2026-07-13-oi-property-facts-commercial-persist.
export function isDedicatedFactKey(k: string): boolean {
  return SET.has(k);
}
