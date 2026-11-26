/**
 * Saves the inspections an import left behind as a package of their own.
 *
 * The bytes come from `extractHeldBackPackage`, which re-reads the original
 * package and writes a new, valid one holding only those inspections (their
 * state, queued changes and photos). It is a plain download: nothing is sent
 * anywhere, and the original file is not touched.
 */
import { extractHeldBackPackage } from "@core/offline-package";

/** Inspection ids are `[A-Za-z0-9_-]{1,64}`, so a name built from one is already safe. */
function heldBackFileName(ids: readonly string[]): string {
    return ids.length === 1 ? `offline-package-left-behind-${ids[0]}.zip` : `offline-package-left-behind-${ids.length}-inspections.zip`;
}

/** Saves bytes as a .zip download. Throws only when the browser refuses the blob URL. */
function downloadZip(bytes: Uint8Array, fileName: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A tick later: some browsers read the URL after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Throws when the package cannot be re-read; the caller says so. */
export function downloadHeldBackPackage(original: Uint8Array, ids: readonly string[]): void {
    downloadZip(extractHeldBackPackage(original, ids), heldBackFileName(ids));
}

/**
 * Downloads a held-back package already extracted (#485): the leftovers saved
 * for a later visit, so there is no original file to re-read.
 */
export function downloadLeftoverPackage(bytes: Uint8Array, ids: readonly string[]): void {
    downloadZip(bytes, heldBackFileName(ids));
}
