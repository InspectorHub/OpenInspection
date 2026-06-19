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
 * Plan 7 — unified media entry (photo OR video). A missing `mediaType`
 * resolves to 'photo' so legacy photo entries (which only ever carried `key`
 * + optional derivative keys) keep working with no data migration.
 *
 * Photos store their bytes in R2 under `key` (+ Plan 4 croppedKey / annotated
 * derivatives). Videos store no R2 object — Cloudflare Stream owns the bytes —
 * so `key` is '' and `streamUid` points at the Stream video. This is a
 * superset of the former `PhotoEntry` shape; `PhotoEntry` is kept as an alias
 * for the existing photo-only call sites and report cascade.
 */
export interface MediaEntry {
    /** R2 key for photos; '' for videos (Cloudflare Stream owns the bytes). */
    key: string;
    /** Discriminator. Absent on legacy entries → treated as 'photo'. */
    mediaType?: 'photo' | 'video';
    /** Cloudflare Stream UID. Present iff mediaType === 'video'. */
    streamUid?: string;
    /** Video poster timestamp as a fraction of duration (0..1). */
    posterPct?: number;
    /** Video duration in seconds (cached from Stream for the thumb badge). */
    durationSec?: number;
    /** Plan 4 — baked cropped JPEG derivative; report precedence annotatedKey||croppedKey||key. */
    croppedKey?: string;
    /** Plan 4 — re-editable crop transform in source-pixel coords (free aspect or a preset). */
    crop?: { aspect: string; orientation: 'landscape' | 'portrait'; x: number; y: number; width: number; height: number };
    /** Annotated composite PNG (baked ON TOP of croppedKey when present). */
    annotatedKey?: string;
    /** Konva node tree + measure calibration JSON. */
    annotationsJson?: string;
    /** User-supplied caption (≤200 chars), surfaces in the published report. */
    caption?: string;
}

/**
 * Legacy alias — photo-only call sites + the Plan 4 report cascade still refer
 * to `PhotoEntry`. It is structurally identical to `MediaEntry` (superset), so
 * the two are interchangeable; new code should prefer `MediaEntry`.
 */
export type PhotoEntry = MediaEntry;

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
    photos?: MediaEntry[];
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
    photos?: MediaEntry[];
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
