import { useCallback, useState } from "react";
import * as Y from "yjs";
import { Modal, PENDING_CLASS, pendingProps, useActionLatch, useLayer } from "@core/shared-ui";
import { projectResults } from "../../shared/results-doc";
import type { ResultsProjection } from "../../shared/results-doc.types";
import type { InspectionDateTimeFormat } from "../../shared/format-date";
import { diffProjections, type FindingDiff } from "../../shared/snapshot-diff";
import type { DiscardedCopyNotice } from "../results-doc-connection";
import { useFieldDataSource } from "../../context";
import { compositeKeysOnly, formatRelativeTime } from "./VersionHistoryPanel";
import { pruneRecoveredField, useCompareRecovery } from "./use-compare-recovery";
import { VersionCompare } from "./VersionCompare";
import { m } from "../../i18n";

/**
 * #478 — the blocking notice for a discarded local copy.
 *
 * The connection drops the device's copy wholesale (a lineage mismatch or a
 * server version restore) and the editor used to show nothing but a small
 * "held" save indicator. This modal names what was lost — the time and the
 * number of findings — and, when the host kept the copy in the one backup
 * slot, offers a one-tap review: the backup diffed against the current report
 * in the shared VersionCompare, with per-value recovery and a whole-backup
 * restore (a Yjs merge back into the live doc, so the restored findings
 * reappear and sync to the server like any other edit).
 *
 * Blocking on purpose: no Escape, no backdrop close — only the two buttons.
 * "Keep current version" dismisses it; a NEW discard shows it again. A
 * discard that held no findings never mounts this at all (the parent gates on
 * `itemCount > 0`): nothing was lost, so there is nothing to interrupt for.
 */

export interface DiscardedCopyNoticeProps {
    /** The latest discard, or null when there is none to show. */
    notice: DiscardedCopyNotice | null;
    inspectionId: string;
    /** The live Y.Doc; null in read-only, where review is read-only too (no recovery, no restore). */
    doc: Y.Doc | null;
    /** The editor's current in-memory results map (the live `to` side of a compare). */
    currentResults: ResultsProjection | null;
    onDismiss: () => void;
}

export function DiscardedCopyNotice({ notice, inspectionId, doc, currentResults, onDismiss }: DiscardedCopyNoticeProps) {
    const dataSource = useFieldDataSource();
    const session = dataSource.session();
    const timeZone = session.timeZone ?? "UTC";
    const fmt: InspectionDateTimeFormat = {
        locale: session.locale,
        dateFormat: session.tenantDateFormat,
        timeFormat: session.tenantTimeFormat,
    };

    // Review state: the backup diffed against the current report.
    const [compareOpen, setCompareOpen] = useState(false);
    const [compareDiffs, setCompareDiffs] = useState<FindingDiff[]>([]);
    const [compareBusy, setCompareBusy] = useState(false);
    const [compareError, setCompareError] = useState<string | null>(null);
    const [backupUpdate, setBackupUpdate] = useState<Uint8Array | null>(null);

    // Whole-backup restore confirmation + progress.
    const [confirmRestore, setConfirmRestore] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const restoreLatch = useActionLatch(restoring);

    // Blocking: Escape does nothing (useLayer still owns focus/scroll while open).
    useLayer(notice !== null, { onEscape: () => { /* acknowledge with a button, not Escape */ } });

    const { recoverField } = useCompareRecovery(doc);
    const handleRecoverField = useCallback(
        (findingKey: string, field: string, value: unknown) => {
            if (!recoverField(findingKey, field, value)) return;
            // The recovered field now matches current; prune it so the row disappears at once.
            setCompareDiffs((prev) => pruneRecoveredField(prev, findingKey, field));
        },
        [recoverField],
    );

    // The host reads the one backup slot; without it there is no review path.
    const reader = dataSource.collab.readDiscardedBackup;
    const canReview = notice !== null && notice.backedUp && typeof reader === "function" && currentResults !== null;

    const handleReview = useCallback(async () => {
        if (!canReview || !reader || !currentResults) return;
        setCompareBusy(true);
        setCompareOpen(true);
        setCompareError(null);
        setCompareDiffs([]);
        setBackupUpdate(null);
        try {
            const slot = await reader(inspectionId);
            if (!slot) throw new Error("backup slot is empty");
            const backupDoc = new Y.Doc();
            try {
                Y.applyUpdate(backupDoc, slot.update);
                setBackupUpdate(slot.update);
                setCompareDiffs(diffProjections(projectResults(backupDoc), compositeKeysOnly(currentResults)));
            } finally {
                backupDoc.destroy();
            }
        } catch (e) {
            console.error("Discarded-copy review failed:", e);
            setCompareOpen(false);
            setCompareError(m.editor_collab_discarded_load_failed());
        } finally {
            setCompareBusy(false);
        }
    }, [canReview, reader, inspectionId, currentResults]);

    const handleRestoreWhole = useCallback(async () => {
        if (!doc || !backupUpdate || restoring) return;
        setRestoring(true);
        setRestoreError(null);
        try {
            // A merge, not a replace: the backup's findings come back into the
            // live doc and sync to the server like any other local edit.
            doc.transact(() => {
                Y.applyUpdate(doc, backupUpdate);
            });
            // The merge alone is NOT enough for scalars: it resolves a
            // same-field conflict by CRDT clock order, and the live doc's
            // clock is routinely higher than the backup's, so the current
            // value would win about half the time. Re-write every differing
            // scalar from the backup as a fresh edit — a new write always
            // carries the highest clock, so the backup's values win
            // deterministically. Findings the backup lacks are left alone
            // (itemAdded): the restore merges, it never deletes newer work.
            for (const diff of compareDiffs) {
                if (diff.itemAdded) continue;
                for (const change of diff.scalarChanges) {
                    recoverField(diff.findingKey, change.field, change.from);
                }
            }
            setConfirmRestore(false);
            setCompareOpen(false);
            onDismiss();
        } catch (e) {
            console.error("Discarded-copy restore failed:", e);
            setRestoreError(m.editor_collab_restore_failed());
        } finally {
            setRestoring(false);
        }
    }, [doc, backupUpdate, restoring, compareDiffs, recoverField, onDismiss]);

    if (notice === null) return null;

    const when = formatRelativeTime(notice.atMs, Date.now(), timeZone, fmt);
    const plural = notice.itemCount === 1 ? "" : "s";
    const fromLabel = `${m.editor_collab_discarded_copy()} · ${when}`;

    return (
        <>
            <div
                className="fixed inset-0 z-50 bg-ih-backdrop flex items-center justify-center p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="discarded-copy-title"
                data-testid="discarded-copy-notice"
            >
                <div className="bg-ih-bg-card rounded-lg shadow-ih-popover w-full max-w-lg max-h-[92vh] overflow-y-auto">
                    <div className="px-6 py-5 space-y-3">
                        <h2 id="discarded-copy-title" className="text-base font-bold text-ih-fg-1">
                            {m.editor_collab_discarded_title()}
                        </h2>
                        <p className="text-[13px] text-ih-fg-2 leading-relaxed">
                            {notice.backedUp
                                ? m.editor_collab_discarded_body({ time: when, count: notice.itemCount, s: plural })
                                : m.editor_collab_discarded_body_no_backup({ time: when, count: notice.itemCount, s: plural })}
                        </p>
                        {compareError && <p className="text-[12px] text-ih-bad-fg">{compareError}</p>}
                    </div>
                    <div className="border-t border-ih-border px-6 py-4 flex items-center justify-end gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="h-10 px-4 rounded-md text-[12px] font-bold border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                        >
                            {m.editor_collab_discarded_keep_current()}
                        </button>
                        {canReview && (
                            <button
                                type="button"
                                {...pendingProps(compareBusy, () => void handleReview())}
                                className={`h-10 px-4 rounded-md text-[12px] font-bold bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 transition-colors ${PENDING_CLASS}`}
                            >
                                {compareBusy ? m.editor_collab_working() : m.editor_collab_discarded_review()}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Review: the backup against the current report, with per-value recovery and whole-backup restore. */}
            <VersionCompare
                open={compareOpen}
                onClose={() => {
                    if (!compareBusy) setCompareOpen(false);
                }}
                title={fromLabel}
                fromLabel={fromLabel}
                toLabel={m.editor_collab_current()}
                diffs={compareDiffs}
                busy={compareBusy}
                footerNote={m.editor_collab_discarded_footer_note()}
                onRecoverField={doc ? handleRecoverField : undefined}
                onRestoreWhole={
                    doc && backupUpdate
                        ? () => {
                              setRestoreError(null);
                              setConfirmRestore(true);
                          }
                        : undefined
                }
            />

            {/* Whole-backup restore confirmation — NEVER window.confirm (repo rule). */}
            <Modal
                open={confirmRestore}
                onClose={() => {
                    if (!restoring) setConfirmRestore(false);
                }}
                title={m.editor_collab_discarded_restore_confirm_title()}
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            {...pendingProps(restoring, () => setConfirmRestore(false))}
                            className={`px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted ${PENDING_CLASS}`}
                        >
                            {m.common_cancel()}
                        </button>
                        <button
                            type="button"
                            {...pendingProps(restoring, () => restoreLatch(handleRestoreWhole))}
                            className={`px-4 h-10 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold hover:bg-ih-primary/85 ${PENDING_CLASS}`}
                        >
                            {restoring ? m.editor_collab_restoring() : m.editor_collab_restore_entire_version()}
                        </button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-2">{m.editor_collab_discarded_restore_confirm_body()}</p>
                {restoreError && <p className="mt-3 text-[12px] text-ih-bad-fg">{restoreError}</p>}
            </Modal>
        </>
    );
}
