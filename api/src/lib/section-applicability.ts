/**
 * Gap 16 — Section applicability resolver.
 *
 * Determines which template sections apply to a given (propertyType, subtype).
 * Used by wizard step 2 and template filtering.
 *
 * Canonical source: Design System 0523 Catalog.jsx sectionApplies().
 */

import type { TemplateSection } from '../types/template-schema';
import type { } from './commercial-subtypes';

export function sectionApplies(
    section: TemplateSection,
    propertyType: string,
    subtypeId?: string | null,
    basedOn?: string | null,
): boolean {
    const app = section.applicableTo;
    if (!app) return true;

    if (app.propertyTypes && !app.propertyTypes.includes(propertyType as 'single-family' | 'multi-unit' | 'commercial')) {
        return false;
    }

    if (propertyType !== 'commercial') return true;

    const subs = app.commercialSubtypes;
    if (!subs || subs.length === 0) return true;

    if (subtypeId && subs.includes(subtypeId)) return true;

    // For org subtypes, check if their platform parent (basedOn) matches
    if (basedOn && subs.includes(basedOn)) return true;

    return false;
}

export function getApplicableSections(
    allSections: TemplateSection[],
    propertyType: string,
    subtypeId?: string | null,
    basedOn?: string | null,
): TemplateSection[] {
    return allSections.filter(s => sectionApplies(s, propertyType, subtypeId, basedOn));
}
