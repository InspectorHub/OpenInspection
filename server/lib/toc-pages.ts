/**
 * Resolve real TOC page numbers out of a Chrome-rendered PDF (Commercial PCA
 * Task 19a — two-pass real TOC page numbers).
 *
 * Chrome's `page.pdf()` encodes intra-doc `<a href="#id">` TOC links as PDF
 * NAMED destinations whose name === the linked element's `id` (verified by
 * `scripts/spike/toc-pdflib-spike.mjs` — see
 * `scripts/spike/toc-pdflib-spike.md` for the full write-up). This module
 * walks the PDF catalog's `/Names -> /Dests` name tree (plus the legacy
 * catalog `/Dests` dict) and resolves each named destination's target page
 * to a 1-based page number, keyed by the destination name (== anchor id).
 *
 * Used by the two-pass renderer (`generatePdfWithTocPages` in
 * `server/lib/pdf.ts`): pass 1 renders the report once, this function reads
 * back where each TOC anchor landed, and pass 2 re-renders with those page
 * numbers injected into the TOC's reserved page-ref column.
 */
import {
    PDFDocument,
    PDFName,
    PDFArray,
    PDFRef,
    PDFDict,
    PDFString,
    PDFHexString,
} from 'pdf-lib';

function lookup(doc: PDFDocument, obj: unknown): unknown {
    return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

function nameString(n: unknown): string | null {
    if (n instanceof PDFString || n instanceof PDFHexString) return n.decodeText();
    if (n instanceof PDFName) return n.decodeText();
    return null;
}

/** Resolve a destination's array form (either the array itself, or a `/D` dict wrapper) to the array. */
function destArrayOf(doc: PDFDocument, dest: unknown): PDFArray | null {
    const d = lookup(doc, dest);
    if (d instanceof PDFArray) return d;
    if (d instanceof PDFDict) {
        const inner = lookup(doc, d.get(PDFName.of('D')));
        return inner instanceof PDFArray ? inner : null;
    }
    return null;
}

/**
 * Walk a `/Names /Dests` name-tree node — either `{ /Names [name dest name
 * dest ...] }` (leaf) or `{ /Kids [node node ...] }` (interior) — collecting
 * name -> dest-array pairs into `out`. Defensive: malformed/missing shapes
 * are skipped rather than thrown.
 */
function walkNameTree(doc: PDFDocument, node: unknown, out: Map<string, PDFArray>): void {
    const n = lookup(doc, node);
    if (!(n instanceof PDFDict)) return;

    const names = lookup(doc, n.get(PDFName.of('Names')));
    if (names instanceof PDFArray) {
        for (let i = 0; i + 1 < names.size(); i += 2) {
            const key = nameString(names.get(i));
            const arr = destArrayOf(doc, names.get(i + 1));
            if (key && arr) out.set(key, arr);
        }
    }

    const kids = lookup(doc, n.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) {
        for (let i = 0; i < kids.size(); i++) walkNameTree(doc, kids.get(i), out);
    }
}

/**
 * Extract `{ anchorId -> 1-based page number }` from a rendered PDF's named
 * destinations. Returns whatever resolves — never throws, even on a
 * malformed/garbage PDF (returns `{}` in that case).
 */
export async function extractAnchorPages(
    pdfBytes: ArrayBuffer | Uint8Array,
): Promise<Record<string, number>> {
    try {
        const doc = await PDFDocument.load(pdfBytes, { throwOnInvalidObject: false });
        const pages = doc.getPages();

        // page object ref tag -> 1-based page index.
        const refToPage = new Map<string, number>();
        pages.forEach((p, i) => refToPage.set(p.ref.tag, i + 1));

        const namedDests = new Map<string, PDFArray>();
        try {
            const namesDict = lookup(doc, doc.catalog.get(PDFName.of('Names')));
            if (namesDict instanceof PDFDict) {
                walkNameTree(doc, namesDict.get(PDFName.of('Dests')), namedDests);
            }
        } catch { /* malformed /Names tree — skip, keep whatever resolved */ }

        // Legacy catalog /Dests dict (pre-name-tree PDFs).
        try {
            const legacyDests = lookup(doc, doc.catalog.get(PDFName.of('Dests')));
            if (legacyDests instanceof PDFDict) {
                for (const [k, v] of legacyDests.entries()) {
                    const arr = destArrayOf(doc, v);
                    if (arr) namedDests.set(k.decodeText(), arr);
                }
            }
        } catch { /* malformed legacy /Dests — skip */ }

        const result: Record<string, number> = {};
        for (const [name, destArray] of namedDests) {
            try {
                const first = destArray.get(0);
                if (!(first instanceof PDFRef)) continue;
                const pageNumber = refToPage.get(first.tag);
                if (pageNumber != null) result[name] = pageNumber;
            } catch { /* unresolvable single entry — skip it, keep the rest */ }
        }
        return result;
    } catch {
        // Malformed PDF (failed to load, or an unexpected shape mid-walk) —
        // never throw; the caller falls back to the un-numbered pass-1 PDF.
        return {};
    }
}
