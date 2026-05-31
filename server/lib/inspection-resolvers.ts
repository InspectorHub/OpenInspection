/**
 * P3 — Explicit resolver functions for inspection unit/section/item resolution.
 *
 * Pure functions that operate on inspection data structures.
 * Canonical source: Design System 0523 Catalog.jsx resolvers.
 */

import type { TemplateSchemaV2, TemplateSection, TemplateBuilding, TemplateUnit } from '../types/template-schema';

export function findUnit(
    structure: { buildings: TemplateBuilding[] } | undefined,
    unitId: string,
): TemplateUnit | null {
    if (!structure?.buildings) return null;
    for (const b of structure.buildings) {
        for (const u of b.units) {
            if (u.id === unitId) return u;
        }
    }
    return null;
}

export function findBuildingOfUnit(
    structure: { buildings: TemplateBuilding[] } | undefined,
    unitId: string,
): TemplateBuilding | null {
    if (!structure?.buildings) return null;
    for (const b of structure.buildings) {
        if (b.units.some(u => u.id === unitId)) return b;
    }
    return null;
}

export interface UnitOverride {
    sectionsIncluded?: string[];
    sectionsExcluded?: string[];
    itemsIncluded?: Record<string, string[]>;
    itemsExcluded?: Record<string, string[]>;
}

export function resolveUnitSections(
    schema: TemplateSchemaV2,
    _unitId: string,
    unitOverrides?: Record<string, UnitOverride>,
    unitId?: string,
): TemplateSection[] {
    const activeUnitId = unitId || _unitId;
    const overrides = unitOverrides?.[activeUnitId];

    let sectionIds = schema.sections.map(s => s.id);

    if (overrides?.sectionsExcluded) {
        sectionIds = sectionIds.filter(id => !overrides.sectionsExcluded!.includes(id));
    }
    if (overrides?.sectionsIncluded) {
        for (const id of overrides.sectionsIncluded) {
            if (!sectionIds.includes(id)) sectionIds.push(id);
        }
    }

    return sectionIds
        .map(id => schema.sections.find(s => s.id === id))
        .filter((s): s is TemplateSection => s != null);
}

export function resolveUnitSectionItems(
    schema: TemplateSchemaV2,
    _unitId: string,
    sectionId: string,
    unitOverrides?: Record<string, UnitOverride>,
    unitId?: string,
): string[] {
    const activeUnitId = unitId || _unitId;
    const section = schema.sections.find(s => s.id === sectionId);
    if (!section) return [];

    let itemIds = section.items.map(i => i.id);
    const overrides = unitOverrides?.[activeUnitId];

    if (overrides?.itemsExcluded?.[sectionId]) {
        itemIds = itemIds.filter(id => !overrides.itemsExcluded![sectionId].includes(id));
    }
    if (overrides?.itemsIncluded?.[sectionId]) {
        for (const id of overrides.itemsIncluded[sectionId]) {
            if (!itemIds.includes(id)) itemIds.push(id);
        }
    }

    return itemIds;
}
