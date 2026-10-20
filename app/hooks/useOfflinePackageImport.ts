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
    IMPORT_LIMIT_CEILINGS, PackageFormatError, readPackageSummary, runImport,
    type ImportOptions, type ImportReport, type PackageSummary,
} from "@core/offline-package";
import { formatFileSize } from "@core/shared-ui";
import { sendOfflinePackage } from "~/lib/offline-package-send";
import { m } from "~/paraglide/messages";

export interface ImportProgress {
    current: number;
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
export function refusalForFile(file: { name: string; size: number }): string | null {
    if (!/\.zip$/i.test(file.name)) return m.offline_import_err_not_zip();
    if (file.size === 0) return m.offline_import_err_empty();
    const max = IMPORT_LIMIT_CEILINGS.compressedBytes;
    if (file.size > max) return m.offline_import_err_too_large({ actual: formatFileSize(file.size), max: formatFileSize(max) });
    return null;
}

export function useOfflinePackageImport(options: ImportOptions = {}) {
    const [state, setState] = useState<ImportState>(IDLE);
    // The package bytes can be 24 MiB; they stay out of React state so a re-render never copies them.
    const bytes = useRef<Uint8Array | null>(null);
    const fileNameRef = useRef("");
    // The summary `choose` already read from these same bytes; `start` reuses it instead of parsing a second time.
    const summaryRef = useRef<PackageSummary | null>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;

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
        setState({ kind: "running", fileName, summary, progress: { current: 1, total: 1, imported: 0, heldBack: 0 } });
        try {
            const report = await runImport(zip, (part) => sendOfflinePackage(part), {
                ...optionsRef.current,
                onProgress: (p) => {
                    optionsRef.current.onProgress?.(p);
                    const total = Math.max(1, p.settled + p.pending);
                    setState((s) => s.kind === "running"
                        ? { ...s, progress: { current: Math.min(total, p.settled + 1), total, imported: p.imported, heldBack: p.heldBack } }
                        : s);
                },
            });
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

    return { state, choose, reset, start, bytes };
}
