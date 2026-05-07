/**
 * Spec 5B — Defect Model + Canned Comment Library.
 *
 * Type definitions for inspection template schemas (schemaVersion 2).
 *
 * Each template has sections; each section has items; each item is now
 * "rich" — carrying three tabs of pre-built canned comments
 * (Information / Limitations / Defects). Inspectors toggle which canned
 * entries are included on a given inspection and may override the comment
 * text or add custom comments.
 *
 * Inspection-result data carries per-item state under
 * InspectionItemState — see `inspection-item-state.ts`.
 */

/** Defect category — drives PDF Summary inclusion. */
export type DefectCategory = 'maintenance' | 'recommendation' | 'safety';

/** Information / Limitations canned entry. */
export interface CannedInfoComment {
    /** Stable id (template-scoped, e.g. "ri1"). */
    id: string;
    /** Short heading shown above the comment in the editor. */
    title: string;
    /** Comment body (plain text). */
    comment: string;
    /** When true, this entry is auto-included on new inspections. */
    default: boolean;
}

/** Defect canned entry — adds category + per-defect location and photos. */
export interface CannedDefect {
    id: string;
    title: string;
    category: DefectCategory;
    /** Free-text location ("Northeast corner") — default empty in template. */
    location: string;
    comment: string;
    /** R2 keys captured at template-level (rare); inspection-side defects
     *  store their own photos in InspectionItemState. */
    photos: string[];
    default: boolean;
}

/** Three-tab canned comment buckets attached to each item. */
export interface ItemTabs {
    information: CannedInfoComment[];
    limitations: CannedInfoComment[];
    defects: CannedDefect[];
}

/** Item types. v2 uses 'rich' for rated inspectable items, 'text' for
 *  free-text-only items (e.g. "Overall Condition Notes"). */
export type ItemType = 'rich' | 'text';

export interface TemplateItem {
    id: string;
    label: string;
    type: ItemType;
    /** Rating options shown at the top of an item card. Required for 'rich'. */
    ratingOptions?: string[];
    /** Three tabs of canned comments. Required for 'rich'. */
    tabs?: ItemTabs;
    /** Optional icon key + display number (used by some templates). */
    icon?: string;
    number?: string;
}

export interface TemplateSection {
    id: string;
    title: string;
    icon?: string;
    items: TemplateItem[];
}

export interface RatingLevel {
    id: string;
    label: string;
    abbreviation?: string;
    color?: string;
    severity?: 'good' | 'minor' | 'marginal' | 'significant';
    isDefect?: boolean;
    description?: string;
}

export interface TemplateSchemaV2 {
    schemaVersion: 2;
    sections: TemplateSection[];
    ratingSystem?: { levels: RatingLevel[] };
}

/**
 * Structural type-guard. Useful at I/O boundaries (DB read, API ingest).
 */
export function isTemplateSchemaV2(value: unknown): value is TemplateSchemaV2 {
    if (!value || typeof value !== 'object') return false;
    const v = value as { schemaVersion?: unknown; sections?: unknown };
    return v.schemaVersion === 2 && Array.isArray(v.sections);
}
