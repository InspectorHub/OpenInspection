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

/** Item types — `rich` is the headline interactive type (rating + three
 *  canned-comment tabs). The 8 simpler types cover non-rated data points
 *  the editor surfaces (booleans, numbers with min/max/unit, single- and
 *  multi-select with choices, date pickers, photo-only fields, and plain
 *  text / textarea inputs). */
export type ItemType =
    | 'rich'
    | 'text'
    | 'boolean'
    | 'textarea'
    | 'number'
    | 'select'
    | 'multi_select'
    | 'date'
    | 'photo_only';

export type ItemAttributeType =
    | 'boolean' | 'text' | 'number' | 'select' | 'multi_select' | 'date';

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
export interface ItemAttribute {
    id: string;
    name: string;
    type: ItemAttributeType;
    choices?: string[];
    unit?: string;
    required?: boolean;
    isSafety?: boolean;
    isDefect?: boolean;
    recommendation?: string | null;
    estimateMin?: number | null;
    estimateMax?: number | null;
}

/** Per-item sub-properties — only meaningful on non-rich types. */
export interface ItemOptions {
    min?: number | null;
    max?: number | null;
    unit?: string;
    step?: number | null;
    placeholder?: string;
    maxLength?: number | null;
    choices?: string[];
    minPhotos?: number | null;
}

/** Provenance for templates imported from upstream platforms. */
export interface ItemSource {
    platform: string;
    externalId: string;
}

export interface TemplateItem {
    id: string;
    label: string;
    type: ItemType;
    description?: string;
    /** Rating options shown at the top of an item card. Required for 'rich'. */
    ratingOptions?: string[];
    /** Three tabs of canned comments. Required for 'rich'. */
    tabs?: ItemTabs;
    /** Sub-properties on non-rich types (min/max/choices/...). */
    options?: ItemOptions;
    /** Optional icon key + display number (used by some templates). */
    icon?: string;
    number?: string;
    required?: boolean;
    isSafety?: boolean;
    defaultRecommendation?: string;
    defaultEstimateMin?: number | null;
    defaultEstimateMax?: number | null;
    attributes?: ItemAttribute[];
    source?: ItemSource | null;
}

export interface TemplateSection {
    id: string;
    title: string;
    icon?: string;
    identifier?: string;
    items: TemplateItem[];
    disclaimerText?: string | null;
    alwaysPageBreak?: boolean;
    source?: ItemSource | null;
}

export interface RatingLevel {
    id: string;
    label: string;
    abbreviation?: string;
    color?: string;
    severity?: 'good' | 'minor' | 'marginal' | 'significant';
    isDefect?: boolean;
    default?: boolean;
    description?: string;
}

export interface RatingSystem {
    name?: string;
    defaultLevelId?: string;
    source?: string | null;
    levels: RatingLevel[];
}

export interface TemplateSchemaV2 {
    schemaVersion: 2;
    sections: TemplateSection[];
    ratingSystem?: RatingSystem;
}

/**
 * Structural type-guard. Useful at I/O boundaries (DB read, API ingest).
 */
export function isTemplateSchemaV2(value: unknown): value is TemplateSchemaV2 {
    if (!value || typeof value !== 'object') return false;
    const v = value as { schemaVersion?: unknown; sections?: unknown };
    return v.schemaVersion === 2 && Array.isArray(v.sections);
}
