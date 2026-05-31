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

export interface AgentRecommendationRow {
    inspectionId:    string;
    propertyAddress: string;
    inspectionDate:  string;
    sectionTitle:    string;
    itemLabel:       string;
    defectTitle:     string;
    category:        DefectCategory;
    comment:         string;
    location:        string | null;
    photos:          string[];
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

interface DefectStateShape {
    cannedId:  string;
    included?: boolean;
    comment?:  string | null;
    category?: string;
    location?: string | null;
    photos?:   Array<{ key?: string } | string> | null;
}
interface ResultsItemShape  { defects?: DefectStateShape[] }
interface ResultsDataShape  { [itemId: string]: ResultsItemShape | undefined }

export interface RawInspectionForRecommendations {
    id:               string;
    propertyAddress:  string;
    date:             string;
    templateSnapshot: unknown;
    resultsData:      unknown;
}

function isCategory(v: unknown): v is DefectCategory {
    return v === 'safety' || v === 'recommendation' || v === 'maintenance';
}

function flattenPhotos(photos: DefectStateShape['photos']): string[] {
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
    const results  = coerceJson<ResultsDataShape>(insp.resultsData);
    if (!snapshot || !Array.isArray(snapshot.sections)) return [];

    const out: AgentRecommendationRow[] = [];
    for (const section of snapshot.sections) {
        for (const item of section.items ?? []) {
            const cannedDefects = item.tabs?.defects ?? [];
            const itemResults   = results?.[item.id];
            const defectStates  = itemResults?.defects ?? [];
            // Index canned by id for fast lookup.
            const cannedById = new Map<string, CannedDefectShape>();
            for (const c of cannedDefects) cannedById.set(c.id, c);

            for (const state of defectStates) {
                if (!state.included) continue;
                const canned = cannedById.get(state.cannedId);
                if (!canned) continue;
                const category = isCategory(state.category)
                    ? state.category
                    : (isCategory(canned.category) ? canned.category : null);
                if (!category) continue;
                out.push({
                    inspectionId:    insp.id,
                    propertyAddress: insp.propertyAddress,
                    inspectionDate:  insp.date,
                    sectionTitle:    section.title,
                    itemLabel:       item.label,
                    defectTitle:     canned.title,
                    category,
                    comment:         (state.comment ?? canned.comment ?? '').toString(),
                    location:        state.location ?? null,
                    photos:          flattenPhotos(state.photos),
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
    for (const r of rows) out[r.category].push(r);
    return out;
}
