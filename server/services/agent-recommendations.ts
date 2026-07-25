// UC-A-5 — flatten an agent's referred-and-delivered inspections into
// per-defect rows grouped by DefectCategory. Pure data transformation; the
// caller fetches the inspection rows and passes them in.
//
// The defect category lives on each canned defect entry in the template
// snapshot (`tabs.defects[*].category`). A defect is "active" on an
// inspection when the inspection's saved field state has
// `defects[cannedId].included === true`. Comments from the field state
// override the canned default; same for photos.

import type { DefectCategory } from '../types/template-schema';
import type { AgentRepairAccess } from '../lib/people/agent-repair-access';
import { readItemDefectStates, readItemEntry } from '../lib/read-item-defects';
import type { ResultsProjection, DefectState } from '../lib/collab/results-doc.types';

export interface AgentRecommendationRow {
    inspectionId:    string;
    // Owning company. The agent portal groups by property and shows the company
    // inline; the slug also addresses the per-inspection repair share channel.
    tenantName:      string;
    tenantSlug:      string;
    /** This company's policy for agents on its repair list (IA-35). */
    repairAccess:    AgentRepairAccess;
    propertyAddress: string;
    inspectionDate:  string;
    sectionTitle:    string;
    itemLabel:       string;
    defectTitle:     string;
    // A defect_categories.id or legacy seed name (DefectCategory is `string`).
    // Kept verbatim — IA-41 no longer drops tenant custom categories.
    category:        DefectCategory;
    comment:         string;
    location:        string | null;
    photos:          string[];
    // IA-41 — true for field-added defects (customComments.defects). Drives the
    // "inspector-added" badge, matching the report side.
    isCustom:        boolean;
}

export interface AgentRecommendationGroups {
    safety:         AgentRecommendationRow[];
    recommendation: AgentRecommendationRow[];
    maintenance:    AgentRecommendationRow[];
}

interface CannedDefectShape {
    id:        string;
    title:     string;
    category?: string;
    location?: string;
    comment?:  string;
    photos?:   unknown[];
}
interface ItemShape    { id: string; label: string; tabs?: { defects?: CannedDefectShape[] } }
interface SectionShape { id: string; title: string; items?: ItemShape[] }
interface SnapshotShape { sections?: SectionShape[] }

export interface RawInspectionForRecommendations {
    id:               string;
    tenantName:       string;
    tenantSlug:       string;
    repairAccess:     AgentRepairAccess;
    propertyAddress:  string;
    date:             string;
    templateSnapshot: unknown;
    resultsData:      unknown;
}

function flattenPhotos(photos: DefectState['photos']): string[] {
    if (!photos || !Array.isArray(photos)) return [];
    const out: string[] = [];
    for (const p of photos) {
        if (typeof p === 'string') out.push(p);
        else if (p && typeof p === 'object' && typeof p.key === 'string') out.push(p.key);
    }
    return out;
}

function coerceJson<T>(v: unknown): T | null {
    if (v == null) return null;
    if (typeof v === 'string') {
        try { return JSON.parse(v) as T; } catch { return null; }
    }
    return v as T;
}

export function flattenInspectionToRecommendations(
    insp: RawInspectionForRecommendations,
): AgentRecommendationRow[] {
    // D1 sometimes hands back a JSON column as a raw string (depending on
    // how the row was originally written); coerce defensively.
    const snapshot = coerceJson<SnapshotShape>(insp.templateSnapshot);
    const results  = coerceJson<ResultsProjection>(insp.resultsData) ?? {};
    if (!snapshot || !Array.isArray(snapshot.sections)) return [];

    const out: AgentRecommendationRow[] = [];
    for (const section of snapshot.sections) {
        for (const item of section.items ?? []) {
            const cannedDefects = item.tabs?.defects ?? [];
            // Read via the shared resolver — the canonical findingKey with a
            // bare-itemId fallback, then `.tabs.defects`. Keying by bare itemId
            // or skipping `.tabs` (the prior bug) reads nothing (IA-31).
            const defectStates  = readItemDefectStates(results, section.id, item.id);
            // Index canned by id for fast lookup.
            const cannedById = new Map<string, CannedDefectShape>();
            for (const c of cannedDefects) cannedById.set(c.id, c);

            for (const state of defectStates) {
                if (!state.included) continue;
                const canned = cannedById.get(state.cannedId);
                if (!canned) continue;
                // IA-41 — keep the category verbatim (tenant custom categories
                // included); fall back to 'maintenance' only when truly unset,
                // mirroring the report side. No longer dropped for being off the
                // three legacy buckets.
                const category = (state.category ?? canned.category ?? 'maintenance').toString();
                out.push({
                    inspectionId:    insp.id,
                    tenantName:      insp.tenantName,
                    tenantSlug:      insp.tenantSlug,
                    repairAccess:    insp.repairAccess,
                    propertyAddress: insp.propertyAddress,
                    inspectionDate:  insp.date,
                    sectionTitle:    section.title,
                    itemLabel:       item.label,
                    defectTitle:     canned.title,
                    category,
                    comment:         (state.comment ?? canned.comment ?? '').toString(),
                    location:        state.location ?? null,
                    photos:          flattenPhotos(state.photos),
                    isCustom:        false,
                });
            }

            // IA-41 — field-added custom defects live in customComments.defects,
            // not in the template's tabs.defects, so the canned pass above never
            // sees them. The report + repair-list surfaces already read them;
            // the agent feed was the lone consumer that dropped them.
            const entry = readItemEntry(results, section.id, item.id);
            for (const cd of entry.customComments?.defects ?? []) {
                if (!cd.included) continue;
                out.push({
                    inspectionId:    insp.id,
                    tenantName:      insp.tenantName,
                    tenantSlug:      insp.tenantSlug,
                    repairAccess:    insp.repairAccess,
                    propertyAddress: insp.propertyAddress,
                    inspectionDate:  insp.date,
                    sectionTitle:    section.title,
                    itemLabel:       item.label,
                    defectTitle:     cd.title,
                    category:        (cd.category ?? 'maintenance').toString(),
                    comment:         (cd.comment ?? '').toString(),
                    location:        cd.location ?? null,
                    photos:          flattenPhotos(cd.photos),
                    isCustom:        true,
                });
            }
        }
    }
    return out;
}

export function groupRecommendations(
    rows: AgentRecommendationRow[],
): AgentRecommendationGroups {
    const out: AgentRecommendationGroups = { safety: [], recommendation: [], maintenance: [] };
    for (const r of rows) {
        // IA-41 — safety and maintenance file directly; everything else —
        // 'recommendation' plus any tenant custom category — merges into the
        // recommendation bucket. This matches the PCA Systems Summary's merge
        // direction (pca-systems-summary.ts) so the two client surfaces agree,
        // and it stops the silent drop of custom-category defects. Each row
        // keeps its real `category`, so the page can flag that a merge happened.
        if (r.category === 'safety') out.safety.push(r);
        else if (r.category === 'maintenance') out.maintenance.push(r);
        else out.recommendation.push(r);
    }
    return out;
}
