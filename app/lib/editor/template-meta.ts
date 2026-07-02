/**
 * PCA / multi-unit editor — pure serialization + normalization for the template
 * property-type and section applicability fields. Kept separate from the React
 * components so payload building is unit-testable without a DOM. Mirrors the
 * server rules: commercialSubtype only for commercial; empty applicability
 * arrays collapse to "applies to all" (matches sectionApplies()).
 */
import type { PropertyType, SectionApplicability, TemplateSection } from '../../components/template/types';

export function serializeTemplateMeta(
  propertyType?: PropertyType,
  commercialSubtype?: string,
): { propertyType?: PropertyType; commercialSubtype?: string } {
  const out: { propertyType?: PropertyType; commercialSubtype?: string } = {};
  if (propertyType) out.propertyType = propertyType;
  if (propertyType === 'commercial' && commercialSubtype) out.commercialSubtype = commercialSubtype;
  return out;
}

export function normalizeApplicability(app: SectionApplicability | undefined): SectionApplicability | undefined {
  if (!app) return undefined;
  const propertyTypes = app.propertyTypes && app.propertyTypes.length ? app.propertyTypes : undefined;
  const commercialSubtypes = app.commercialSubtypes && app.commercialSubtypes.length ? app.commercialSubtypes : undefined;
  if (!propertyTypes && !commercialSubtypes) return undefined;
  const out: SectionApplicability = {};
  if (propertyTypes) out.propertyTypes = propertyTypes;
  if (commercialSubtypes) out.commercialSubtypes = commercialSubtypes;
  return out;
}

export function toggleInArray<T>(arr: T[] | undefined, value: T, on: boolean): T[] {
  const set = new Set(arr ?? []);
  if (on) set.add(value); else set.delete(value);
  return Array.from(set);
}

export function serializeSectionMeta(
  section: Pick<TemplateSection, 'defaultScope' | 'applicableTo'>,
): { defaultScope?: 'common' | 'unit'; applicableTo?: SectionApplicability } {
  const out: { defaultScope?: 'common' | 'unit'; applicableTo?: SectionApplicability } = {};
  if (section.defaultScope) out.defaultScope = section.defaultScope;
  const app = normalizeApplicability(section.applicableTo);
  if (app) out.applicableTo = app;
  return out;
}
