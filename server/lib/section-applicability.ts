/**
 * Section applicability resolver — FROZEN / DEAD CODE (module A of the
 * authoring-surface unification, see docs/superpowers/plans/2026-07-04-
 * authoring-unification-plan3-template-side.md: the template editor is now
 * property-type-as-identity, so sections no longer carry authored applicability).
 *
 * Not deleted because: (1) `tests/unit/inspections/commercial-subtypes.spec.ts` still exercises
 * `sectionApplies`/`getApplicableSections` directly, and (2) the `applicableTo`
 * JSON-schema field is frozen in place to avoid OpenAPI-snapshot churn (pre-launch,
 * no data to migrate). No production caller invokes these. Do NOT re-wire into the
 * editor; revive only under a future spec that re-introduces authored applicability.
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
