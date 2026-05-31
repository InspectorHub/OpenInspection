/**
 * Spec 5B — Per-item state stored under inspection_results.data.
 *
 * Per the spec's Section 3.4 design, each item-result records:
 *   - Which canned comments are included (by id) + per-comment text overrides
 *   - Per-defect location override + photos
 *   - Custom inspector-added comments (same shape, prefixed id)
 *   - Free-text additional notes
 *
 * For Spec 5B P0 we keep this state inside `inspection_results.data` keyed
 * by item id, alongside the existing `rating` / `notes` / `photos` fields,
 * to avoid a destructive D1 schema migration on a not-yet-launched system.
 * (The spec mentions a separate `inspection_item_states` table — punt to a
 *  follow-up if the embedded approach proves limiting.)
 */
import type { DefectCategory } from './template-schema';
import type { DefectTrade, DefectDeadline, DefectTimeframe } from './defect-fields';

/**
 * State for a non-defect canned comment (Information / Limitations).
 * `cannedId` references the corresponding entry in the template's
 * `tabs.information` / `tabs.limitations` array.
 */
export interface CannedCommentState {
    cannedId: string;
    included: boolean;
    /** When non-null, overrides the template's comment text. */
    comment?: string | null;
}

/**
 * State for a defect canned comment. Adds category override (defaults to
 * the template's category) + location + structured trade/deadline/timeframe
 * + per-defect photos.
 */
export interface DefectCommentState {
    cannedId: string;
    included: boolean;
    comment?: string | null;
    category?: DefectCategory;
    location?: string | null;
    trade?: DefectTrade | null;
    deadline?: DefectDeadline | null;
    timeframe?: DefectTimeframe | null;
    photos?: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }>;
}

/**
 * Per-item state recorded on an inspection.
 */
export interface InspectionItemState {
    /** Currently-selected rating option (e.g. 'Inspected', 'Repair'). */
    rating?: string | null;
    /** Free-text notes (legacy field — still supported alongside tabs). */
    notes?: string;
    /** Item-level photos (legacy bucket — still supported). */
    photos?: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }>;
    /** New v2 tab state. Optional so legacy item-results render cleanly. */
    tabs?: {
        information?: CannedCommentState[];
        limitations?: CannedCommentState[];
        defects?: DefectCommentState[];
    };
    /** Inspector-added custom comments not present in the template. */
    customComments?: {
        information?: Array<CannedCommentState & { title: string }>;
        limitations?: Array<CannedCommentState & { title: string }>;
        defects?: Array<DefectCommentState & { title: string }>;
    };
}
