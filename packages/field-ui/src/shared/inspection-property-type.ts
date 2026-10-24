/**
 * What kind of building an inspection is of — the single source for the
 * `inspections.property_type` wire schema and for the new-inspection wizard's
 * selector, so the value the inspector picks and the value the API accepts
 * cannot drift apart.
 *
 * These are UNDERSCORE slugs, and that is the shape stored on the column. The
 * template/marketplace side of the product uses HYPHEN slugs for the same three
 * concepts (`PropertyTypeEnum` in `lib/validations/template.schema.ts`), and the
 * two vocabularies are bridged in exactly one place — `normalizePropertyType`
 * in `lib/commercial-subtypes.ts`. Do not add a second bridge, and do not
 * "fix" a reader by storing the hyphen form: `inspection-edit.tsx`,
 * `pca-report-block.ts`, `report-tier.ts` and `PropertyInfoForm.tsx` all
 * compare against `'commercial'`, which is spelled the same either way, so a
 * hyphen-spelled residential value would silently change nothing visible while
 * breaking the Building Profile preset lookup.
 *
 * Why the column is nullable and stays nullable: rows created before the value
 * was captured have no property type, and `null` is not `single_family` — the
 * report layer asks "is this commercial" and must get "no", not "no, and also
 * assume a detached house". Every reader already treats null as "unclassified".
 */
export const INSPECTION_PROPERTY_TYPES = [
    'single_family',
    'multi_unit',
    'commercial',
] as const;

export type InspectionPropertyType = (typeof INSPECTION_PROPERTY_TYPES)[number];
