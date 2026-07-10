/**
 * Single source of truth for the `inspection_results.data` JSON projection.
 *
 * A Yjs Durable Object will materialize this shape as its authoritative
 * projection so that all existing readers (report service, PDF renderer, etc.)
 * remain unchanged when the bespoke per-field-CAS path is retired.
 *
 * IMPORTANT — what is NOT here by design:
 *   The per-field CAS metadata (<field>_v / <field>_by / <field>_at,
 *   _lastWriter, _lastWriteAt) is intentionally excluded from this projection
 *   shape. Those fields are part of the bespoke conflict-detection layer that
 *   the Yjs CRDT migration retires (see #181). They live in the raw
 *   inspection_results.data blob today but must not leak into the stable
 *   Yjs-projected view.
 */

// ─── Leaf types ──────────────────────────────────────────────────────────────

/** Re-editable crop transform (source-pixel coords) baked into a cropped photo. */
export interface PhotoCropTransform {
    aspect:      string;
    orientation: 'landscape' | 'portrait';
    x:           number;
    y:           number;
    width:       number;
    height:      number;
}

/** A photo / video attachment stored inside an inspection result. */
export interface PhotoEntry {
    key:             string;
    croppedKey?:     string;
    /** Re-editable crop transform recorded alongside `croppedKey`. */
    crop?:           PhotoCropTransform;
    annotatedKey?:   string;
    annotationsJson?: string;
    mediaType?:      'photo' | 'video';
    provider?:       'stream' | 'r2';
    streamUid?:      string;
    mediaId?:        string;
    posterKey?:      string;
    posterPct?:      number;
    durationSec?:    number;
    /** #181 PR-G — true while the binary is only in the local pending store (not yet on R2). */
    pendingUpload?:  boolean;
    /** #181 PR-G — id into the local media-pending IndexedDB store; resolves to a local blob URL. */
    pendingId?:      string;
    /**
     * #181 PR-G — which offline operation produced this pending entry. `'photo'`
     * is a brand-new offline photo (paired with `pendingUpload: true` + an empty
     * `key`, so the report skips it). `'crop'` / `'annotate'` are offline
     * derivatives of an EXISTING photo: the base `key` is KEPT (and serves the
     * report as an honest fallback) and `pendingUpload` is NOT set, while the
     * editor shows the local derivative preview until the upload drains.
     */
    pendingKind?:    'photo' | 'crop' | 'annotate';
}

/** Toggle-state for a single canned information or limitation comment. */
export interface CannedState {
    cannedId:  string;
    included:  boolean;
    comment?:  string | null;
}

/**
 * Snapshot of a repair item attached to a finding.
 *
 * Read by `server/lib/aggregate-recommendations.ts`
 * (`aggregateAttachedRecommendations`, the `GET /:id/recommendations` list).
 */
export interface RepairItemSnapshot {
    recommendationId:       string;
    estimateSnapshotMin:    number | null;
    estimateSnapshotMax:    number | null;
    summarySnapshot:        string;
    contractorTypeSnapshot: string | null;
    attachedAt:             number;
}

/**
 * A per-inspection custom comment (inspector free-text, not from the library).
 *
 * Read by `server/services/inspection/inspection-report.service.ts`
 * (`mapCustomDefectsForReport` reads `res.customComments.defects`).
 */
export interface CustomCommentEntry {
    id:        string;
    title:     string;
    comment:   string;
    included:  boolean;
    category?: string;
    location?: string;
    photos?:   PhotoEntry[];
}

/** Toggle-state for a single canned defect, with per-defect overrides. */
export interface DefectState {
    cannedId:          string;
    included:          boolean;
    comment?:          string | null;
    /** References a `defect_categories.id` (or a legacy seed name). Widened
     *  from the former 3-value enum — Authoring unification Plan-4 module K. */
    category?:         string;
    location?:         string | null;
    photos?:           PhotoEntry[];
    recommendationId?: string | null;
    estimateLow?:      number | null;
    estimateHigh?:     number | null;
    trade?:            string | null;
    deadline?:         string | null;
    timeframe?:        string | null;
}

// ─── Projection types ────────────────────────────────────────────────────────

/**
 * Composite finding key for one result entry.
 * Runtime format: `"_default:{sectionId}:{itemId}"` (via `findingKey()`).
 */
export type FindingKey = string;

/**
 * Per-item result entry — the value stored at each `FindingKey` inside
 * `inspection_results.data`.
 *
 * This is the shape the report service reads verbatim: rating, notes, value,
 * attributes, tabs (information / limitations / defects), photos, original
 * (re-inspection snapshot), followupStatus, followupNotes.
 *
 * NOTE: the per-field CAS metadata (<field>_v/_by/_at, _lastWriter,
 * _lastWriteAt) is intentionally NOT part of this projection shape — it is
 * being retired as part of the Yjs CRDT migration (#181).
 */
export interface ItemEntry {
    rating?:         string;
    notes?:          string;
    photos?:         PhotoEntry[];
    recommendation?: string;
    estimateMin?:    number;
    estimateMax?:    number;
    attributes?:     Record<string, unknown>;
    value?:          unknown;
    tabs?: {
        information?: CannedState[];
        limitations?: CannedState[];
        defects?:     DefectState[];
    };
    /** Re-inspection: snapshot of the original finding before the follow-up. */
    original?: {
        rating?:  string | null;
        notes?:   string | null;
        photos?:  PhotoEntry[];
    };
    /** Re-inspection disposition assigned by the inspector. */
    followupStatus?: string | null;
    followupNotes?:  string | null;
    /** Repair items attached to this finding (read by aggregate-recommendations). */
    recommendations?: RepairItemSnapshot[];
    /** Per-inspection custom comments, grouped by tab. */
    customComments?: {
        information?: CustomCommentEntry[];
        limitations?: CustomCommentEntry[];
        defects?:     CustomCommentEntry[];
    };
}

/**
 * The full `inspection_results.data` projection: a map of composite finding
 * keys to per-item result entries.
 */
export type ResultsProjection = Record<FindingKey, ItemEntry>;
