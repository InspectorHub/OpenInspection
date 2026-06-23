import { useCallback, useEffect, useState } from "react";
import { Modal } from "@core/shared-ui";

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

interface Snapshot {
    seq: number;
    atMs: number;
    byUserId: string | null;
}

export interface VersionHistoryPanelProps {
    open: boolean;
    onClose: () => void;
    inspectionId: string;
    /** Called after a restore succeeds (Task 12b will use this to trigger resync;
     *  for now the editor just revalidates / shows a toast). */
    onRestored?: (seq: number) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

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
        out.push({ seq: rec.seq, atMs: rec.atMs, byUserId });
    }
    return out;
}

export function VersionHistoryPanel({
    open,
    onClose,
    inspectionId,
    onRestored,
}: VersionHistoryPanelProps) {
    const [loadState, setLoadState] = useState<LoadState>("idle");
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [saving, setSaving] = useState(false);

    // Restore-confirmation modal state.
    const [confirmSeq, setConfirmSeq] = useState<number | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);

    const base = `/api/inspections/${inspectionId}/collab`;

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
                                            {snap.byUserId === null ? "Auto-saved" : snap.byUserId}
                                        </div>
                                    </div>
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
        </>
    );
}
