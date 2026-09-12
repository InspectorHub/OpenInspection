/**
 * One catalogue row AS THE API ACTUALLY ANSWERS IT.
 *
 * The browse card used to describe its own row inline, through
 * `raw as unknown as { … description?: string; category?: string; author?: string }`.
 * A double assertion is not a check: it told the compiler the response had three
 * fields it has never had, so every optional chain and truthiness test over them
 * was dead code the type checker was happy with. The card rendered a name and
 * nothing else while the response carried an item count, a version, a release
 * note and a download count that nothing read — one cast losing data in both
 * directions at once.
 *
 * So the shape is written down ONCE, here, and it is the `marketplace_libraries`
 * row minus the pack blob, plus exactly what `browseCatalogue` computes on top
 * (`importedSemver`, `hasUpdate`, `itemCount`, `description`). `narrowEntry`
 * does the narrowing at runtime rather than asserting it, so a field that stops
 * arriving reads as absent instead of as `undefined` dressed up as a string.
 */

/** Which local table an install writes; mirrors `MARKETPLACE_KINDS`. */
/** Not exported: used only by the narrowing below, in this module. */
type MarketplaceEntryKind = "comments" | "templates" | "statutory";

export interface MarketplaceEntry {
  id: string;
  name: string;
  kind: MarketplaceEntryKind | null;
  /** The catalogue's version. Compared for EQUALITY only — never ordered. */
  semver: string | null;
  /** The pack's own "what is this", lifted out of the schema blob server-side. */
  description: string | null;
  /** Release note for this version. Written by the seeder; now also read. */
  changelog: string | null;
  /** How many importable items the pack advertises. 0 for a 1:1 kind. */
  itemCount: number | null;
  downloadCount: number | null;
  featured: boolean;
  /** The three independent browse axes. All null for non-template kinds. */
  propertyType: string | null;
  jurisdiction: string | null;
  inspectionKind: string | null;
  /** The version this workspace installed, or null when it has none. */
  importedSemver: string | null;
  hasUpdate: boolean;
}

const KINDS: readonly MarketplaceEntryKind[] = ["comments", "templates", "statutory"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Narrow one loader row. Anything missing or mistyped becomes null/false. */
export function narrowEntry(raw: unknown): MarketplaceEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = KINDS.find((k) => k === r.kind) ?? null;
  return {
    id: String(r.id ?? ""),
    name: str(r.name) ?? "",
    kind,
    semver: str(r.semver),
    description: str(r.description),
    changelog: str(r.changelog),
    itemCount: num(r.itemCount),
    downloadCount: num(r.downloadCount),
    featured: r.featured === true,
    propertyType: str(r.propertyType),
    jurisdiction: str(r.jurisdiction),
    inspectionKind: str(r.inspectionKind),
    importedSemver: str(r.importedSemver),
    hasUpdate: r.hasUpdate === true,
  };
}
