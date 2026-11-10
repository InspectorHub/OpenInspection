import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';

/**
 * One persisted projection snapshot — a point-in-time copy of the doc projected
 * to the `inspection_results.data` JSON shape. Snapshots are doc-replacement
 * restore points (Condition B): restore rebuilds a fresh Y.Doc from `projection`
 * rather than replaying CRDT updates.
 */
export interface ResultsSnapshot {
    seq:        number;
    atMs:       number;
    byUserId:   string | null;
    /**
     * Why the snapshot was taken (see #181 PR-H):
     *   'periodic' — the auto every-SNAPSHOT_EVERY capture in onDocUpdate.
     *   'manual'   — an on-demand POST capture or restore's pre-restore capture.
     *   'connect'  — the pre-merge boundary capture taken when a client reconnects,
     *                BEFORE its buffered offline edits merge (preserves the
     *                about-to-be-overwritten value for the H2 compare/recover UI).
     *   'import'   — the mandatory capture before an offline client's update is applied.
     *   'pre-rename' — the capture before legacy finding keys are renamed inside the document.
     * Optional so legacy snapshots persisted before this field stay readable.
     */
    reason?:    SnapshotReason;
    projection: ResultsProjection;
}

/** Discriminator for why a snapshot was captured. */
export type SnapshotReason = 'periodic' | 'manual' | 'connect' | 'import' | 'pre-rename';

/** Snapshot metadata (the list view omits the heavy `projection` payload). */
export type ResultsSnapshotMeta = Omit<ResultsSnapshot, 'projection'>;

/**
 * Narrow an `unknown` value loaded from DO storage to a snapshot array. DO
 * storage round-trips structured-clone, so the shape is trusted, but a defensive
 * guard keeps the no-`any` rule and tolerates a missing/legacy key.
 */
export function asSnapshotArray(value: unknown): ResultsSnapshot[] {
    return Array.isArray(value) ? (value as ResultsSnapshot[]) : [];
}

