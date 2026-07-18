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

