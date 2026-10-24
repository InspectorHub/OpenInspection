import { useCallback, useEffect, useState } from "react";
import type * as Y from "yjs";
import { Modal, pendingProps, PENDING_CLASS, useActionLatch } from "@core/shared-ui";
import { applyItemPatch } from "../../shared/results-doc";
import type { ResultsProjection } from "../../shared/results-doc.types";
import { diffProjections, type FindingDiff, type ScalarField } from "../../shared/snapshot-diff";
import { VersionCompare } from "./VersionCompare";
import { useReturnFocusAfterCompare } from "./useReturnFocusAfterCompare";
import { useFieldDataSource } from "../../context";
import type { VersionSnapshotEntry } from "../../data-source-types";
import { formatShapedDate, type InspectionDateTimeFormat } from "../../shared/format-date";
import { m } from "../../i18n";

/**
 * #181 — Version history panel (collab Phase 4 / PR-D, Task 12a).
 *
 * Lists the Durable-Object version snapshots for an inspection, lets the
 * inspector capture an on-demand version, and restore the report content to a
 * prior snapshot (behind a custom confirm modal — repo rule forbids
 * `window.confirm`). All of it goes through the data source's
 * `resources.versionHistory` (list, get, capture, restore); the web host serves
 * it from the collab namespace.
 *
 * This is UI + wiring ONLY: a successful restore calls `onRestored(seq)` so the
 * editor can revalidate; live multi-client convergence is Task 12b.
 */

type SnapshotReason = NonNullable<VersionSnapshotEntry["reason"]>;

export interface VersionHistoryPanelProps {
    open: boolean;
    onClose: () => void;
    inspectionId: string;
    /** Called after a restore succeeds (Task 12b will use this to trigger resync;
     *  for now the editor just revalidates / shows a toast). */
    onRestored?: (seq: number) => void;
    /**
     * #181 PR-H — the live Y.Doc (threaded from inspection-edit.tsx). Required for
     * the Compare → "Recover this value" flow, which writes the recovered scalar
     * back into the doc. When null the Compare action degrades to whole-version
     * restore only (single-value recovery is hidden).
     */
    doc?: Y.Doc | null;
    /**
     * #181 PR-H — the editor's current in-memory results map (the live `to` side
     * of a compare). A snapshot's projection is the `from` side. When absent the
     * Compare action is hidden (nothing to diff against).
     */
    currentResults?: ResultsProjection | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/** The scalar fields written via `applyItemPatch`; guards the recover write.
 *  No estimateMin / estimateMax: recovering an old version must not be a way to
 *  put a repair price back into a live document. */
const SCALAR_FIELD_SET = new Set<ScalarField>([
    "rating",
    "notes",
    "value",
    "recommendation",
    "followupStatus",
    "followupNotes",
]);

/** Human label for a snapshot's capture reason (surfaces the pre-merge boundary). */
function reasonLabel(reason: SnapshotReason | undefined, byUserId: string | null): string {
    if (reason === "connect") return m.editor_collab_autosaved_before_reconnect();
    if (reason === "periodic") return m.editor_collab_autosaved();
    // 'manual' (or legacy/no reason): show the actor when known.
    return byUserId === null ? m.editor_collab_autosaved() : byUserId;
}

/**
 * Tiny dependency-free relative-time formatter ("just now", "2 minutes ago",
 * "3 hours ago", "5 days ago"). Falls back to an absolute date past a week.
 *
 * `timeZone` and `fmt` are REQUIRED for the fallback branch (#270). The old
 * `new Date(atMs).toLocaleDateString()` read the BROWSER's zone and locale, so
 * two collaborators on the same document could see two different dates against
 * the same snapshot — and this list is the one place they point at a version
 * and say "restore that one". Both resolve from the TENANT
 * (`useInspectionDateTimeFormat`) for exactly that reason.
 */
export function formatRelativeTime(
    atMs: number,
    now: number,
    timeZone: string,
    fmt: InspectionDateTimeFormat,
): string {
    const diffMs = now - atMs;
    if (!Number.isFinite(diffMs) || diffMs < 0) return m.editor_collab_just_now();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 45) return m.editor_collab_just_now();
    const min = Math.floor(sec / 60);
    if (min < 60) return m.editor_collab_minutes_ago({ min, s: min === 1 ? "" : "s" });
    const hr = Math.floor(min / 60);
    if (hr < 24) return m.editor_collab_hours_ago({ hr, s: hr === 1 ? "" : "s" });
    const day = Math.floor(hr / 24);
    if (day < 7) return m.editor_collab_days_ago({ day, s: day === 1 ? "" : "s" });
    return formatShapedDate(atMs, timeZone, fmt);
}

/**
 * The editor's live ResultMap is DUAL-KEYED (each entry stored under both the
 * composite `unit:section:item` key AND the bare itemId — see
 * `results-binding.ts#readResultMap`). For diffing we want ONLY the composite
 * keys, which match a snapshot projection's keys; the bare-itemId aliases would
 * otherwise appear as spurious "added" findings.
 */
function compositeKeysOnly(results: ResultsProjection): ResultsProjection {
    const out: ResultsProjection = {};
    for (const [key, value] of Object.entries(results)) {
        if (key.split(":").length >= 3) out[key] = value;
    }
    return out;
}

export function VersionHistoryPanel({
    open,
    onClose,
    inspectionId,
    onRestored,
    doc,
    currentResults,
}: VersionHistoryPanelProps) {
    const [loadState, setLoadState] = useState<LoadState>("idle");
    const [snapshots, setSnapshots] = useState<VersionSnapshotEntry[]>([]);
    const [saving, setSaving] = useState(false);

    // Restore-confirmation modal state.
    const [confirmSeq, setConfirmSeq] = useState<number | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    // Same-frame guards: the pending state only lands after a render, so two clicks in one frame would each
    // capture a version (save) or each re-run the restore and write a second pre-restore version row.
    const saveLatch = useActionLatch(saving);
    const restoreLatch = useActionLatch(restoring);

    // #181 PR-H — Compare-against-current modal state.
    const [compareOpen, setCompareOpen] = useState(false);
    const [compareSeq, setCompareSeq] = useState<number | null>(null);
    const [compareDiffs, setCompareDiffs] = useState<FindingDiff[]>([]);
    const [compareBusy, setCompareBusy] = useState(false);

    const canCompare = !!currentResults;

    const returnFocus = useReturnFocusAfterCompare(confirmSeq !== null);

    // Tenant-anchored (#270): every collaborator on this document must read the
    // same date off this list. The zone is the viewer's display zone (UTC when the
    // host has none); the language follows the viewer and the date shape the tenant.
    const dataSource = useFieldDataSource();
    const versionHistory = dataSource.resources.versionHistory;
    const session = dataSource.session();
    const timeZone = session.timeZone ?? "UTC";
    const fmt: InspectionDateTimeFormat = {
        locale: session.locale,
        dateFormat: session.tenantDateFormat,
        timeFormat: session.tenantTimeFormat,
    };

    // #181 PR-H — open Compare for a row: fetch that snapshot's projection (the
    // `from` side) and diff it against the editor's live results (`to` = current).
    const handleCompare = useCallback(
        async (seq: number) => {
            if (!currentResults) return;
            setCompareSeq(seq);
            setCompareBusy(true);
            setCompareOpen(true);
            setCompareDiffs([]);
            try {
                const got = await versionHistory?.get(inspectionId, seq);
                if (!got?.ok || !got.data) throw new Error(got?.error ?? "snapshot has no projection");
                setCompareDiffs(
                    diffProjections(got.data.projection, compositeKeysOnly(currentResults)),
                );
            } catch (e) {
                console.error("Version compare load failed:", e);
                setCompareOpen(false);
                setCompareSeq(null);
            } finally {
                setCompareBusy(false);
            }
        },
        [versionHistory, inspectionId, currentResults],
    );

    // #181 PR-H — recover a single OLD scalar into the LIVE doc. The finding key
    // is the composite `unit:section:item`; `applyItemPatch` writes the scalar
    // CRDT field directly (one helper covers all 8 scalars). Live doc → DO persist.
    const handleRecoverField = useCallback(
        (findingKey: string, field: string, value: unknown) => {
            if (!doc) return;
            if (!SCALAR_FIELD_SET.has(field as ScalarField)) return;
            applyItemPatch(doc, findingKey, field as ScalarField, value);
            // Reflect the recovery: the recovered field now matches current, so it
            // drops out of the diff on the next compare. Recompute against live.
            if (currentResults) {
                // The live doc bind updates currentResults asynchronously; do a local
                // optimistic prune so the recovered row disappears immediately.
                setCompareDiffs((prev) =>
                    prev
                        .map((d) =>
                            d.findingKey === findingKey
                                ? {
                                      ...d,
                                      scalarChanges: d.scalarChanges.filter(
                                          (c) => c.field !== field,
                                      ),
                                  }
                                : d,
                        )
                        .filter(
                            (d) =>
                                d.scalarChanges.length > 0 ||
                                d.nestedChanged ||
                                d.itemAdded ||
                                d.itemRemoved,
                        ),
                );
            }
        },
        [doc, currentResults],
    );

    const loadSnapshots = useCallback(async () => {
        setLoadState("loading");
        try {
            const listed = await versionHistory?.list(inspectionId);
            if (!listed?.ok || !listed.data) throw new Error(listed?.error ?? "versions could not be read");
            setSnapshots(listed.data);
            setLoadState("ready");
        } catch (e) {
            console.error("Version history load failed:", e);
            setLoadState("error");
        }
    }, [versionHistory, inspectionId]);

    // Fetch the list each time the panel transitions to open.
    useEffect(() => {
        if (!open) return;
        // Reset transient state so a reopened panel starts clean.
        setConfirmSeq(null);
        setRestoreError(null);
        void loadSnapshots();
    }, [open, loadSnapshots]);

    async function handleSaveNow() {
        if (saving) return;
        setSaving(true);
        try {
            const captured = await versionHistory?.capture(inspectionId);
            if (!captured?.ok) throw new Error(captured?.error ?? "version was not captured");
            await loadSnapshots();
        } catch (e) {
            console.error("Capture version failed:", e);
            setLoadState("error");
        } finally {
            setSaving(false);
        }
    }

    async function handleConfirmRestore() {
        if (confirmSeq === null || restoring) return;
        setRestoring(true);
        setRestoreError(null);
        try {
            const restored = await versionHistory?.restore(inspectionId, confirmSeq);
            if (!restored?.ok) throw new Error(restored?.error || m.editor_collab_restore_failed());
            const restoredSeq = confirmSeq;
            setConfirmSeq(null);
            await loadSnapshots();
            onRestored?.(restoredSeq);
        } catch (e) {
            setRestoreError(e instanceof Error ? e.message : m.editor_collab_restore_failed());
        } finally {
            setRestoring(false);
        }
    }

    const saveAction = (
        <button
            type="button"
            // aria-disabled while saving: this sits inside an open Modal, where native disabled drops focus to <body>.
            {...pendingProps(saving, () => saveLatch(handleSaveNow))}
            className={`h-9 px-3 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary/85 inline-flex items-center gap-1.5 ${PENDING_CLASS}`}
        >
            {saving ? m.editor_collab_saving() : m.editor_collab_save_version_now()}
        </button>
    );

    return (
        <>
            <Modal open={open} onClose={onClose} title={m.editor_collab_version_history()} size="lg">
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[12px] text-ih-fg-3">
                            {m.editor_collab_history_desc()}
                        </p>
                        {saveAction}
                    </div>

                    {loadState === "loading" && (
                        <p className="py-6 text-center text-[13px] text-ih-fg-3">{m.editor_collab_loading_versions()}</p>
                    )}

                    {loadState === "error" && (
                        <div className="py-6 text-center space-y-2">
                            <p className="text-[13px] text-ih-bad-fg">{m.editor_collab_load_failed()}</p>
                            <button
                                type="button"
                                onClick={() => void loadSnapshots()}
                                className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-2 hover:bg-ih-bg-muted"
                            >
                                {m.editor_collab_try_again()}
                            </button>
                        </div>
                    )}

                    {loadState === "ready" && snapshots.length === 0 && (
                        <p className="py-6 text-center text-[13px] text-ih-fg-3">{m.editor_collab_no_versions()}</p>
                    )}

                    {loadState === "ready" && snapshots.length > 0 && (
                        <ul className="divide-y divide-ih-border rounded-lg border border-ih-border overflow-hidden">
                            {snapshots.map((snap) => (
                                <li
                                    key={snap.seq}
                                    className="flex items-center justify-between gap-3 px-3 py-2.5 bg-ih-bg-card"
                                >
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-semibold text-ih-fg-1">
                                            {formatRelativeTime(snap.atMs, Date.now(), timeZone, fmt)}
                                        </div>
                                        <div className="text-[11px] text-ih-fg-3 truncate">
                                            {reasonLabel(snap.reason, snap.byUserId)}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {canCompare && (
                                            <button
                                                type="button"
                                                onClick={(e) => { returnFocus.rememberOpener(e.currentTarget); void handleCompare(snap.seq); }}
                                                className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-2 hover:bg-ih-bg-muted"
                                            >
                                                {m.editor_collab_compare()}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRestoreError(null);
                                                setConfirmSeq(snap.seq);
                                            }}
                                            className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-2 hover:bg-ih-bg-muted"
                                        >
                                            {m.editor_collab_restore()}
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Modal>

            {/* Custom restore confirmation — NEVER window.confirm (repo rule). */}
            <Modal
                open={confirmSeq !== null}
                onClose={() => {
                    if (!restoring) setConfirmSeq(null);
                }}
                title={m.editor_collab_restore_confirm_title()}
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            {...pendingProps(restoring, () => setConfirmSeq(null))}
                            className={`px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted ${PENDING_CLASS}`}
                        >
                            {m.common_cancel()}
                        </button>
                        <button
                            type="button"
                            {...pendingProps(restoring, () => restoreLatch(handleConfirmRestore))}
                            className={`px-4 h-10 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold hover:bg-ih-primary/85 ${PENDING_CLASS}`}
                        >
                            {restoring ? m.editor_collab_restoring() : m.editor_collab_restore_version()}
                        </button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-2">
                    {m.editor_collab_restore_confirm_body()}
                </p>
                {restoreError && (
                    <p className="mt-3 text-[12px] text-ih-bad-fg">{restoreError}</p>
                )}
            </Modal>

            {/* #181 PR-H — Compare this snapshot against the CURRENT live state. */}
            <VersionCompare
                open={compareOpen}
                onClose={() => {
                    if (!compareBusy) {
                        setCompareOpen(false);
                        setCompareSeq(null);
                    }
                }}
                fromLabel={
                    compareSeq === null
                        ? m.editor_collab_selected_version()
                        : m.editor_collab_version_n({ seq: compareSeq })
                }
                toLabel={m.editor_collab_current()}
                diffs={compareDiffs}
                busy={compareBusy}
                // Single-value recovery requires the live doc; hide it otherwise.
                onRecoverField={doc ? handleRecoverField : undefined}
                onRestoreWhole={
                    compareSeq === null
                        ? undefined
                        : () => {
                              const seq = compareSeq;
                              returnFocus.markFromCompare();
                              setCompareOpen(false);
                              setCompareSeq(null);
                              setRestoreError(null);
                              setConfirmSeq(seq);
                          }
                }
            />
        </>
    );
}
