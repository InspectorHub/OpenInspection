/**
 * The template snapshot as the loader receives it: a JSON string or an object (the inspection
 * row's JSON column arrives as an object). An object is returned as the SAME reference, so a
 * caller that wants to modify it must copy first -- the loader hands one copy to the page as the
 * raw snapshot and overlays report-data onto a separate shallow copy.
 *
 * An unparseable string throws; the loader reports that failure itself.
 */
export function parseSnapshot(raw: unknown): unknown {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
