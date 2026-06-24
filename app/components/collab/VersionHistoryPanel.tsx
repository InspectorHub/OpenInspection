import { useCallback, useEffect, useState } from "react";
import type * as Y from "yjs";
import { Modal } from "@core/shared-ui";
import { applyItemPatch } from "../../../server/lib/collab/results-doc";
import type { ResultsProjection } from "../../../server/lib/collab/results-doc.types";
import { diffProjections, type FindingDiff, type ScalarField } from "~/lib/collab/snapshot-diff";
import { VersionCompare } from "~/components/collab/VersionCompare";

/**
 * #181 — Version history panel (collab Phase 4 / PR-D, Task 12a).
 *
 * Lists the Durable-Object version snapshots for an inspection, lets the
 * inspector capture an on-demand version, and restore the report content to a
 * prior snapshot (behind a custom confirm modal — repo rule forbids
 * `window.confirm`). All three endpoints are reached by DIRECT browser `fetch`
 * with `credentials: 'same-origin'` because the collab namespace is JWT-cookie
 * authed at the worker entry (no React Router resource route needed) — the same
 * pattern as `CancelModal` / `PublishModal`.
 *
 * This is UI + wiring ONLY: a successful restore calls `onRestored(seq)` so the
 * editor can revalidate; live multi-client convergence is Task 12b.
 */

/** Why a snapshot was captured (mirrors the DO's SnapshotReason). */
type SnapshotReason = "periodic" | "manual" | "connect";

interface Snapshot {
    seq: number;
    atMs: number;
    byUserId: string | null;
    reason?: SnapshotReason;
}

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

/** The 8 scalar fields written via `applyItemPatch`; guards the recover write. */
const SCALAR_FIELD_SET = new Set<ScalarField>([
    "rating",
    "notes",
    "value",
    "recommendation",
    "estimateMin",
    "estimateMax",
    "followupStatus",
    "followupNotes",
]);

/** Human label for a snapshot's capture reason (surfaces the pre-merge boundary). */
function reasonLabel(reason: SnapshotReason | undefined, byUserId: string | null): string {
    if (reason === "connect") return "Auto-saved before a reconnect";
    if (reason === "periodic") return "Auto-saved";
    // 'manual' (or legacy/no reason): show the actor when known.
    return byUserId === null ? "Auto-saved" : byUserId;
}

/**
 * Tiny dependency-free relative-time formatter ("just now", "2 minutes ago",
 * "3 hours ago", "5 days ago"). Falls back to a locale date for older entries.
 */
export function formatRelativeTime(atMs: number, now: number = Date.now()): string {
    const diffMs = now - atMs;
    if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
    const sec = Math.floor(diffMs / 1000);
    if (sec < 45) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
    return new Date(atMs).toLocaleDateString();
}

/** Narrow an `unknown` JSON payload to the snapshot list shape. */
function parseSnapshots(raw: unknown): Snapshot[] {
    if (!Array.isArray(raw)) return [];
    const out: Snapshot[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const rec = entry as Record<string, unknown>;
        if (typeof rec.seq !== "number" || typeof rec.atMs !== "number") continue;
        const byUserId =
            typeof rec.byUserId === "string" ? rec.byUserId : null;
        const reason =
            rec.reason === "periodic" || rec.reason === "manual" || rec.reason === "connect"
                ? (rec.reason as SnapshotReason)
                : undefined;
        out.push({ seq: rec.seq, atMs: rec.atMs, byUserId, reason });
    }
    return out;
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

/** Narrow the `:seq` snapshot response to its `projection` map (or null). */
function parseSnapshotProjection(raw: unknown): ResultsProjection | null {
    if (typeof raw !== "object" || raw === null) return null;
    const proj = (raw as Record<string, unknown>).projection;
    if (typeof proj !== "object" || proj === null) return null;
    return proj as ResultsProjection;
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
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [saving, setSaving] = useState(false);

    // Restore-confirmation modal state.
    const [confirmSeq, setConfirmSeq] = useState<number | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);

    // #181 PR-H — Compare-against-current modal state.
    const [compareOpen, setCompareOpen] = useState(false);
    const [compareSeq, setCompareSeq] = useState<number | null>(null);
    const [compareDiffs, setCompareDiffs] = useState<FindingDiff[]>([]);
    const [compareBusy, setCompareBusy] = useState(false);

    const canCompare = !!currentResults;

    const base = `/api/inspections/${inspectionId}/collab`;

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
                const res = await fetch(`${base}/snapshots/${seq}`, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const raw: unknown = await res.json();
                const projection = parseSnapshotProjection(raw);
                if (!projection) throw new Error("snapshot has no projection");
                setCompareDiffs(
                    diffProjections(projection, compositeKeysOnly(currentResults)),
                );
            } catch (e) {
                console.error("Version compare load failed:", e);
                setCompareOpen(false);
                setCompareSeq(null);
            } finally {
                setCompareBusy(false);
            }
        },
        [base, currentResults],
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
            const res = await fetch(`${base}/snapshots`, {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw: unknown = await res.json();
            setSnapshots(parseSnapshots(raw));
            setLoadState("ready");
        } catch (e) {
            console.error("Version history load failed:", e);
            setLoadState("error");
        }
    }, [base]);

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
            const res = await fetch(`${base}/snapshots`, {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
            const res = await fetch(`${base}/restore`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ seq: confirmSeq }),
            });
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try {
                    const err: unknown = await res.json();
                    if (
                        typeof err === "object" &&
                        err !== null &&
                        typeof (err as Record<string, unknown>).error === "string"
                    ) {
                        msg = (err as Record<string, string>).error;
                    }
                } catch {
                    // keep the HTTP status message
                }
                throw new Error(msg);
            }
            const restoredSeq = confirmSeq;
            setConfirmSeq(null);
            await loadSnapshots();
            onRestored?.(restoredSeq);
        } catch (e) {
            setRestoreError(e instanceof Error ? e.message : "Restore failed");
        } finally {
            setRestoring(false);
        }
    }

    const saveAction = (
        <button
            type="button"
            onClick={handleSaveNow}
            disabled={saving}
            className="h-9 px-3 rounded-md bg-ih-primary text-white text-[12px] font-bold hover:bg-ih-primary/85 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
            {saving ? "Saving..." : "Save version now"}
        </button>
    );

    return (
        <>
            <Modal open={open} onClose={onClose} title="Version history" size="lg">
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[12px] text-ih-fg-3">
                            Saved versions of this report. Restore replaces the current
                            content with the selected version.
                        </p>
                        {saveAction}
                    </div>

                    {loadState === "loading" && (
                        <p className="py-6 text-center text-[13px] text-ih-fg-3">Loading versions...</p>
                    )}

                    {loadState === "error" && (
                        <div className="py-6 text-center space-y-2">
                            <p className="text-[13px] text-ih-bad">Could not load version history.</p>
                            <button
                                type="button"
                                onClick={() => void loadSnapshots()}
                                className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-2 hover:bg-ih-bg-muted"
                            >
                                Try again
                            </button>
                        </div>
                    )}

                    {loadState === "ready" && snapshots.length === 0 && (
                        <p className="py-6 text-center text-[13px] text-ih-fg-3">No saved versions yet</p>
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
                                            {formatRelativeTime(snap.atMs)}
                                        </div>
                                        <div className="text-[11px] text-ih-fg-3 truncate">
                                            {reasonLabel(snap.reason, snap.byUserId)}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {canCompare && (
                                            <button
                                                type="button"
                                                onClick={() => void handleCompare(snap.seq)}
                                                className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-2 hover:bg-ih-bg-muted"
                                            >
                                                Compare
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
                                            Restore
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
                title="Restore this version?"
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setConfirmSeq(null)}
                            disabled={restoring}
                            className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmRestore}
                            disabled={restoring}
                            className="px-4 h-10 rounded-xl bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary/85 disabled:opacity-50"
                        >
                            {restoring ? "Restoring..." : "Restore version"}
                        </button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-2">
                    Restoring replaces the current report content with the selected
                    version. The current state is saved as a new version first, so this
                    is reversible.
                </p>
                {restoreError && (
                    <p className="mt-3 text-[12px] text-ih-bad">{restoreError}</p>
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
                        ? "Selected version"
                        : `Version #${compareSeq}`
                }
                toLabel="Current"
                diffs={compareDiffs}
                busy={compareBusy}
                // Single-value recovery requires the live doc; hide it otherwise.
                onRecoverField={doc ? handleRecoverField : undefined}
                onRestoreWhole={
                    compareSeq === null
                        ? undefined
                        : () => {
                              const seq = compareSeq;
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
