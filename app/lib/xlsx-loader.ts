/**
 * The browser entry point to the vendored ExcelJS build.
 *
 * ⚠️ DO NOT `import ExcelJS from 'exceljs'` here. That one line would put
 * 947 KB into a client chunk that every page with an upload form downloads, and
 * it would defeat the entire design: nothing under `app/` or `server/` imports
 * the package, so no bundler ever sees the specifier, and the library reaches
 * the page only as a URL. The type below is therefore the minimum this module
 * uses, declared locally.
 *
 * Two things a later reader will otherwise undo:
 *
 * 1. **The CSP permits this.** `script-src 'self'` (see
 *    `server/lib/middleware/security-headers.ts`) allows a same-origin script
 *    tag, and `/vendor/exceljs.min.js` is same-origin.
 * 2. **The file is a Workers Asset, not code.** `scripts/vendor-copy.js` copies
 *    it into `public/`, which the build copies into `build/client`, which
 *    `wrangler.jsonc` declares as the assets directory. It is uploaded
 *    separately from the worker script, so it counts against neither the 3 MiB
 *    gzip ceiling nor any client bundle. The cost is one cached same-origin GET
 *    the first time somebody picks a workbook — and nothing at all for somebody
 *    who never picks one.
 */
import type { WorkbookLike } from './xlsx-import';

/** Same-origin, served out of `build/client`. Kept as a constant because the
 *  test asserts on it and the vendor-copy script writes it. */
const VENDOR_URL = '/vendor/exceljs.min.js';

/** The slice of the UMD global this module uses. Everything past
 *  `worksheets` is `~/lib/xlsx-import`'s business, not this file's. */
export interface ExcelJsNamespace {
    Workbook: new () => {
        xlsx: { load(data: ArrayBuffer): Promise<unknown> };
        worksheets?: unknown;
    };
}

/**
 * The in-flight or settled load, so a second workbook in the same page load
 * costs nothing.
 *
 * A FAILED load stays memoised on purpose: a page whose fetch of the reader
 * failed keeps behaving the same way for the rest of its life instead of
 * retrying silently on every file pick. Nothing is lost by that — an
 * unreadable workbook is uploaded exactly as it is and handled the way it is
 * today.
 */
let pendingLoad: Promise<ExcelJsNamespace> | null = null;

function globalExcelJs(): ExcelJsNamespace | null {
    return (globalThis as { ExcelJS?: ExcelJsNamespace }).ExcelJS ?? null;
}

/**
 * The vendored UMD build, loaded at most once. Resolves `window.ExcelJS`.
 *
 * When the global is already set this resolves without touching the DOM, which
 * is both the memoised production path and the seam the tests drive a real
 * library through.
 */
export function loadExcelJs(): Promise<ExcelJsNamespace> {
    const already = globalExcelJs();
    if (already) return Promise.resolve(already);
    if (pendingLoad) return pendingLoad;

    pendingLoad = new Promise<ExcelJsNamespace>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = VENDOR_URL;
        script.async = true;
        script.addEventListener('load', () => {
            const namespace = globalExcelJs();
            // A 200 that served the wrong bytes looks exactly like a successful
            // load. Rejecting here keeps that failure where it happened,
            // instead of surfacing as "not a constructor" inside the panel.
            if (namespace) resolve(namespace);
            else reject(new Error(`${VENDOR_URL} loaded but defined no ExcelJS global.`));
        });
        script.addEventListener('error', () => {
            reject(new Error(`Could not load ${VENDOR_URL}.`));
        });
        document.head.appendChild(script);
    });
    return pendingLoad;
}

/**
 * A parsed workbook in the shape `~/lib/xlsx-import` consumes.
 *
 * Rejects — never returns a half-built workbook — when the script fails to
 * arrive, when the bytes are not a workbook, or when the parsed object carries
 * no `worksheets`. The caller treats every rejection identically: the original
 * file is left in the input and uploaded untouched.
 */
export async function loadWorkbookFromFile(file: File): Promise<WorkbookLike> {
    const ExcelJs = await loadExcelJs();
    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    if (!Array.isArray(workbook.worksheets)) {
        throw new Error('The workbook parsed but carries no worksheets.');
    }
    return workbook as unknown as WorkbookLike;
}
