/**
 * State of the offline-package import page: choose, preview, run, result.
 *
 * Why this runs in the browser with a component-level `fetch` (inside
 * `sendOfflinePackage`) and not through a route action: a package is up to
 * 24 MiB and a full import spends most of a request's subrequest budget, so an
 * action that buffered the upload and then forwarded it would add the session and
 * loader revalidation work on top. The accepted exception to "actions first" is
 * documented in `~/lib/offline-package-send`. The consequence is that the
 * same-frame guard lives with the caller: the page wraps `start` in
 * `useActionLatch`, because two clicks can land before `running` is rendered.
 *
 * The preview reads only the manifest and the two indexes (`readPackageSummary`).
 * Nothing leaves the browser until `start` is called.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
    extractHeldBackPackage, IMPORT_LIMIT_CEILINGS, PackageFormatError, readPackageSummary, runImport,
    type ImportOptions, type ImportReport, type PackageSummary,
} from "@core/offline-package";
import { formatFileSize } from "@core/shared-ui";
import { sendOfflinePackage } from "~/lib/offline-package-send";
import { indexedDbLeftoverStore, type LeftoverPackage, type LeftoverStore } from "~/lib/offline-package-leftovers";
import { m } from "~/paraglide/messages";

/**
 * Progress counted in inspections, not in parts: the package names a fixed number of inspections, and each one ends
 * up imported or left behind exactly once. The number of parts is not known up front (a refusal cuts the named
 * inspection away and the rest is sent again), so a part counter would keep growing while the import runs.
 */
export interface ImportProgress {
    /** Inspections that have been imported or left behind so far. */
    done: number;
    /** Inspections the package names. Fixed for the whole run. */
    total: number;
    imported: number;
    heldBack: number;
}

export type ImportState =
    | { kind: "idle"; error: string | null }
    | { kind: "preview"; fileName: string; summary: PackageSummary; error: string | null }
    | { kind: "running"; fileName: string; summary: PackageSummary; progress: ImportProgress }
    | { kind: "done"; fileName: string; summary: PackageSummary; report: ImportReport };

const IDLE: ImportState = { kind: "idle", error: null };

/** Why a chosen file is refused before it is even opened, or null. */
function refusalForFile(file: { name: string; size: number }): string | null {
    if (!/\.zip$/i.test(file.name)) return m.offline_import_err_not_zip();
    if (file.size === 0) return m.offline_import_err_empty();
    const max = IMPORT_LIMIT_CEILINGS.compressedBytes;
    if (file.size > max) return m.offline_import_err_too_large({ actual: formatFileSize(file.size), max: formatFileSize(max) });
    return null;
}

export function useOfflinePackageImport(
    options: ImportOptions = {},
    tenantId?: string,
    /** Test seam: the slot the leftovers are kept in. Defaults to IndexedDB. */
    leftoverStore?: LeftoverStore,
) {
    const [state, setState] = useState<ImportState>(IDLE);
    // The package bytes can be 24 MiB; they stay out of React state so a re-render never copies them.
    const bytes = useRef<Uint8Array | null>(null);
    const fileNameRef = useRef("");
    // The summary `choose` already read from these same bytes; `start` reuses it instead of parsing a second time.
    const summaryRef = useRef<PackageSummary | null>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    // Same as `optionsRef`: `start` is a `[]`-deps callback, so the tenant it
    // saves leftovers under is read through a ref, not captured at first render.
    const tenantIdRef = useRef(tenantId);
    tenantIdRef.current = tenantId;
    // #485 — the leftovers of the last import with anything held back, kept
    // past a reload in the store above. The store is fixed at first render:
    // swapping it mid-page would orphan whatever the previous one held.
    const storeRef = useRef(leftoverStore ?? indexedDbLeftoverStore());
    const [leftover, setLeftover] = useState<LeftoverPackage | null>(null);

    // A leftover from another company is not this page's to offer: the slot
    // is per browser profile, and the download would only fail to import.
    useEffect(() => {
        let live = true;
        void storeRef.current.read().then((saved) => {
            if (live && saved && (tenantId === undefined || saved.tenantId === tenantId)) setLeftover(saved);
        });
        return () => {
            live = false;
        };
    }, [tenantId]);

    const discardLeftover = useCallback(() => {
        void storeRef.current.clear();
        setLeftover(null);
    }, []);

    const choose = useCallback(async (file: File) => {
        bytes.current = null;
        summaryRef.current = null;
        const refusal = refusalForFile(file);
        if (refusal) {
            setState({ kind: "idle", error: refusal });
            return;
        }
        try {
            const read = new Uint8Array(await file.arrayBuffer());
            const summary = readPackageSummary(read);
            bytes.current = read;
            summaryRef.current = summary;
            fileNameRef.current = file.name;
            setState({ kind: "preview", fileName: file.name, summary, error: null });
        } catch {
            setState({ kind: "idle", error: m.offline_import_err_unreadable() });
        }
    }, []);

    const reset = useCallback(() => {
        bytes.current = null;
        summaryRef.current = null;
        setState(IDLE);
    }, []);

    /** Runs the import of the chosen package. The caller guards it against a second call in the same frame. */
    const start = useCallback(async () => {
        const zip = bytes.current;
        const summary = summaryRef.current;
        // Both are set together by `choose`, which refuses a file it cannot read; neither is set before a file is chosen.
        if (!zip || !summary) return;
        const fileName = fileNameRef.current;
        const total = Math.max(1, summary.counts.inspections);
        setState({ kind: "running", fileName, summary, progress: { done: 0, total, imported: 0, heldBack: 0 } });
        try {
            const report = await runImport(zip, (part) => sendOfflinePackage(part), {
                ...optionsRef.current,
                onProgress: (p) => {
                    optionsRef.current.onProgress?.(p);
                    setState((s) => s.kind === "running"
                        ? { ...s, progress: { done: Math.min(s.progress.total, p.imported + p.heldBack), total: s.progress.total, imported: p.imported, heldBack: p.heldBack } }
                        : s);
                },
            });
            // #485 — keep the leftovers past a reload: the extracted held-back
            // package is the recovery copy, and it is small (only what was left
            // behind). A clean import clears the slot. Keeping it must never
            // fail the import itself, so every failure here is swallowed.
            if (report.heldBack.length > 0) {
                try {
                    const ids = report.heldBack.map((h) => h.id);
                    const saved: LeftoverPackage = { bytes: extractHeldBackPackage(zip, ids), ids, tenantId: tenantIdRef.current ?? "", savedAt: Date.now() };
                    await storeRef.current.save(saved);
                    setLeftover(saved);
                } catch {
                    // No recovery copy kept; the in-memory download still works this visit.
                }
            } else {
                void storeRef.current.clear();
                setLeftover(null);
            }
            setState({ kind: "done", fileName, summary, report });
        } catch (error) {
            // `runImport` rejects only for a package it cannot read; nothing was sent.
            const message = error instanceof PackageFormatError ? m.offline_import_err_unreadable() : m.offline_import_run_failed();
            setState({ kind: "preview", fileName, summary, error: message });
        }
    }, []);

    // Leaving mid-import abandons the parts not yet sent (the file is unchanged and can be imported again,
    // but the person should be asked first). The browser shows its own standard prompt, so no copy here.
    const running = state.kind === "running";
    useEffect(() => {
        if (!running) return;
        const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [running]);

    return { state, choose, reset, start, bytes, leftover, discardLeftover };
}
