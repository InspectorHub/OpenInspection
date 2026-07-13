import type { PropertyMetaField } from "../../server/lib/commercial-subtypes";

// Resolve the Property Info field preset for the editor (design 2026-07-13).
// A commercial inspection with a chosen subtype gets that subtype's preset, so
// its report-visible fields (nra/floorCount/sprinklered for office, gla/parking
// for retail, ...) become editable and persist through the property_facts
// metadata envelope. Returns undefined in every other case — residential, or
// commercial with no/unknown subtype — so PropertyInfoForm falls back to its
// own default field set. That guard matters twice: residential must NOT adopt
// the single-family preset (it drops bedrooms/bathrooms/unit/county), and a
// subtype-less commercial inspection must NOT render an empty form
// (getMetadataPreset('commercial', null) is []).
export function resolveActivePropertyPreset(
  propertyType: string | null | undefined,
  commercialSubtype: string | null | undefined,
  presets: Record<string, PropertyMetaField[]> | undefined,
): PropertyMetaField[] | undefined {
  if (propertyType !== "commercial") return undefined;
  if (!commercialSubtype) return undefined;
  return presets?.[`commercial:${commercialSubtype}`];
}
