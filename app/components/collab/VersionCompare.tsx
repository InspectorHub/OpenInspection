import { useEffect } from "react";
import type { FindingDiff } from "~/lib/collab/snapshot-diff";

/**
 * #181 PR-H (Task H2) — version compare + field recovery modal.
 *
 * Resurrects the UI SHELL of the deleted `app/components/sync/ConflictModal.tsx`
 * (header + list/detail body + DS `ih-*` tokens) but drives it from a plain
 * `FindingDiff[]` (the output of `diffProjections`) instead of the old diff3
 * `Conflict[]`. There is NO diff3 / CAS / expectedVersion / ours-theirs-base
 * logic here — this is a READ-ONLY compare plus two explicit recover affordances:
 *
 *   - per scalar row: "Recover this value" → writes the OLD (`from`) value back
 *     into the live Y.Doc via `onRecoverField(findingKey, field, change.from)`.
 *   - footer "Restore entire version" → `onRestoreWhole` (the existing
 *     POST …/collab/restore path) for nested / wholesale recovery.
 *
 * Custom modal (repo rule forbids `window.confirm`); Escape + backdrop close.
 */

export interface VersionCompareProps {
    open: boolean;
    onClose: () => void;
    /** Label for the OLDER side, e.g. "Version #12 · 2h ago · Alice". */
    fromLabel: string;
    /** Label for the NEWER side, e.g. "Current". */
    toLabel: string;
    diffs: FindingDiff[];
    /** Human item name for a finding key (falls back to the raw key). */
    itemLabelFor?: (findingKey: string) => string;
    /** Recover a single scalar — receives the OLD value to write into the live doc. */
    onRecoverField?: (findingKey: string, field: string, value: unknown) => void;
    /** Whole-version restore (existing endpoint). */
    onRestoreWhole?: () => void;
    /** Disables the action buttons while a write/restore is in flight. */
    busy?: boolean;
}

/** Render an arbitrary scalar value as a short, readable string for the diff cell. */
function displayValue(value: unknown): string {
    if (value === undefined || value === null) return "—";
    if (typeof value === "string") return value === "" ? "(empty)" : value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function VersionCompare({
    open,
    onClose,
    fromLabel,
    toLabel,
    diffs,
    itemLabelFor,
    onRecoverField,
    onRestoreWhole,
    busy = false,
}: VersionCompareProps) {
    // Escape closes (unless busy) — mirrors the editor's other custom modals.
    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape" && !busy) onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, busy, onClose]);

    if (!open) return null;

    const labelFor = (key: string) => itemLabelFor?.(key) ?? key;

    return (
        <div
            className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.7)] backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-compare-title"
        >
            <div className="bg-ih-bg-card rounded-lg shadow-ih-popover w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <header className="px-6 py-4 border-b border-ih-border flex items-center gap-4">
                    <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-ih-primary text-white flex-shrink-0"
                        aria-hidden="true"
                    >
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                        >
                            <path d="M4 7h16M4 12h16M4 17h10" />
                        </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                        <h2 id="version-compare-title" className="text-base font-bold text-ih-fg-1">
                            Compare versions
                        </h2>
                        <p className="text-xs text-ih-fg-3 mt-0.5">
                            <span className="font-semibold text-ih-fg-2">{fromLabel}</span>
                            {" → "}
                            <span className="font-semibold text-ih-fg-2">{toLabel}</span>
                            {" · recover an individual value, or restore the whole version below."}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-md text-xs font-bold border border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-50 transition-colors"
                    >
                        Close
                    </button>
                </header>

                {/* Body — list of changed findings */}
                <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
                    {diffs.length === 0 && (
                        <div className="py-10 text-center">
                            <p className="text-[13px] text-ih-fg-3">
                                No differences between these versions.
                            </p>
                        </div>
                    )}

                    {diffs.map((diff) => {
                        // Column labels reflect the framing: from = older snapshot, to = current.
                        const fromHead = diff.itemAdded ? "(not present)" : fromLabel;
                        const toHead = diff.itemRemoved ? "(removed)" : toLabel;
                        return (
                            <section
                                key={diff.findingKey}
                                className="rounded-lg border border-ih-border overflow-hidden"
                            >
                                <header className="px-4 py-2.5 bg-ih-bg-muted border-b border-ih-border flex items-center gap-2 flex-wrap">
                                    <h3 className="text-[13px] font-bold text-ih-fg-1 truncate">
                                        {labelFor(diff.findingKey)}
                                    </h3>
                                    {diff.itemAdded && (
                                        <span className="ih-pill ih-pill--monitor">Added since this version</span>
                                    )}
                                    {diff.itemRemoved && (
                                        <span className="ih-pill ih-pill--monitor">Removed since this version</span>
                                    )}
                                </header>

                                <div className="divide-y divide-ih-border">
                                    {/* Scalar rows */}
                                    {diff.scalarChanges.map((change) => (
                                        <div
                                            key={change.field}
                                            className="px-4 py-3 grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-3 items-start"
                                        >
                                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 pt-1">
                                                {change.field}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1">
                                                    {fromHead}
                                                </div>
                                                <pre className="bg-ih-bg-app/40 border border-ih-border rounded-md p-2 text-[12px] text-ih-fg-2 whitespace-pre-wrap break-words leading-relaxed">
                                                    {displayValue(change.from)}
                                                </pre>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-ih-primary mb-1">
                                                    {toHead}
                                                </div>
                                                <pre className="bg-ih-primary-tint border border-ih-primary-tint rounded-md p-2 text-[12px] text-ih-fg-1 whitespace-pre-wrap break-words leading-relaxed">
                                                    {displayValue(change.to)}
                                                </pre>
                                            </div>
                                            <div className="flex md:justify-end md:pt-5">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onRecoverField?.(
                                                            diff.findingKey,
                                                            change.field,
                                                            change.from,
                                                        )
                                                    }
                                                    disabled={busy || !onRecoverField}
                                                    className="h-8 px-3 rounded-md text-[12px] font-bold bg-ih-primary text-white hover:bg-ih-primary-600 disabled:opacity-50 transition-colors whitespace-nowrap"
                                                    title="Write the older value back into the current report"
                                                >
                                                    Recover this value
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Coarse nested note */}
                                    {diff.nestedChanged && (
                                        <div className="px-4 py-3 flex items-start gap-2 bg-ih-bg-muted/40">
                                            <span className="ih-pill ih-pill--monitor flex-shrink-0">
                                                Photos / comments changed
                                            </span>
                                            <p className="text-[12px] text-ih-fg-3 leading-snug">
                                                {diff.nestedSummary
                                                    ? `${diff.nestedSummary}. `
                                                    : ""}
                                                Use “Restore entire version” below to roll back these
                                                nested changes — individual recovery is not available for
                                                photos, defects, or custom comments.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>

                {/* Footer — whole-version restore */}
                <footer className="border-t border-ih-border px-6 py-4 flex items-center gap-3 flex-wrap">
                    <p className="text-[11px] text-ih-fg-3 flex-1 leading-snug min-w-[220px]">
                        Recovering a single value writes it into the live report. Restoring the entire
                        version replaces all current content with this version (your current state is
                        saved as a new version first, so it is reversible).
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="h-10 px-4 rounded-md text-[12px] font-bold border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-50 transition-colors"
                    >
                        Done
                    </button>
                    {onRestoreWhole && (
                        <button
                            type="button"
                            onClick={onRestoreWhole}
                            disabled={busy}
                            className="h-10 px-4 rounded-md text-[12px] font-bold border border-ih-bad text-ih-bad-fg hover:bg-ih-bad-bg disabled:opacity-50 transition-colors"
                        >
                            {busy ? "Working…" : "Restore entire version"}
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
}
