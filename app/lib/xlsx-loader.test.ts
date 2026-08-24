// @vitest-environment happy-dom
/**
 * The browser entry point to the vendored ExcelJS build.
 *
 * The module is driven through its own seam: when `window.ExcelJS` is already
 * set, `loadExcelJs` resolves it without touching the DOM. That is the memoised
 * path in production AND the way these tests put a REAL library behind
 * `loadWorkbookFromFile` — the node build of the same version — so the round
 * trip below parses bytes a real workbook writer produced, without fetching the
 * 947 KB asset.
 *
 * The injection itself is exercised separately, with no global set, by
 * dispatching `load` and `error` on the element the module appended.
 */
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VENDOR_SRC = '/vendor/exceljs.min.js';

/** Captured before anything spies on it. */
const realCreateElement = document.createElement.bind(document);

type Loader = typeof import('./xlsx-loader');

/** A module registry reset per case, because the load promise is memoised at
 *  module scope: without this the second case would inherit the first's memo
 *  and prove nothing. */
async function freshLoader(): Promise<Loader> {
    vi.resetModules();
    return import('./xlsx-loader');
}

function vendorScripts(): NodeListOf<HTMLScriptElement> {
    return document.querySelectorAll<HTMLScriptElement>(`script[src="${VENDOR_SRC}"]`);
}

function setGlobalExcelJs(value: unknown): void {
    (window as unknown as Record<string, unknown>).ExcelJS = value;
}

function clearGlobalExcelJs(): void {
    delete (window as unknown as Record<string, unknown>).ExcelJS;
}

/** A real `.xlsx`, written by the real library, wrapped in a real `File`. */
async function workbookFile(name: string, sheets: string[]): Promise<File> {
    const wb = new ExcelJS.Workbook();
    for (const sheet of sheets) wb.addWorksheet(sheet).addRow(['name', 'email']);
    const buffer = await wb.xlsx.writeBuffer();
    return new File([buffer as ArrayBuffer], name, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}

beforeEach(() => {
    // ⚠️ happy-dom resolves a `<script src>` the moment it is CONNECTED, and
    // with JavaScript evaluation off (vitest's default) it dispatches `error`
    // synchronously inside `appendChild`, before this file gets a turn. Every
    // case below would then be asserting on happy-dom's refusal rather than on
    // this module, and the `load` path would be untestable. Neither
    // `disableJavaScriptFileLoading` nor `handleDisabledFileLoadingAsSuccess`
    // helps: they only choose WHICH event is dispatched synchronously.
    //
    // A `type` happy-dom does not recognise as JavaScript makes it skip the
    // element entirely, which leaves it inert and both outcomes drivable one
    // per case. Real browsers behave this way already — a script's load and
    // error events are always delivered as later tasks, never inside
    // `appendChild` — so this restores the ordering production has, rather than
    // inventing one.
    vi.spyOn(document, 'createElement').mockImplementation(
        ((tagName: string, options?: ElementCreationOptions) => {
            const element = realCreateElement(tagName, options);
            if (tagName.toLowerCase() === 'script') element.setAttribute('type', 'text/plain');
            return element;
        }) as typeof document.createElement,
    );
    document.head.innerHTML = '';
    clearGlobalExcelJs();
});

afterEach(() => {
    vi.restoreAllMocks();
    clearGlobalExcelJs();
});

describe('loadWorkbookFromFile', () => {
    it('parses a real workbook and hands back its worksheets', async () => {
        setGlobalExcelJs(ExcelJS);
        const { loadWorkbookFromFile } = await freshLoader();

        const workbook = await loadWorkbookFromFile(await workbookFile('Contacts.xlsx', ['Cover', 'Contacts']));

        expect(workbook.worksheets.map((w) => w.name)).toEqual(['Cover', 'Contacts']);
        // The library was already there, so nothing was fetched for it.
        expect(vendorScripts()).toHaveLength(0);
    });

    it('rejects rather than returning an empty workbook when the bytes are not a workbook', async () => {
        setGlobalExcelJs(ExcelJS);
        const { loadWorkbookFromFile } = await freshLoader();

        const junk = new File(['this is not a zip at all'], 'Contacts.xlsx', { type: 'text/plain' });

        // A half-built workbook resolving here is the failure that matters: the
        // panel would see zero sheets, call it unreadable, and be right — but
        // only by accident. The rejection is the contract.
        await expect(loadWorkbookFromFile(junk)).rejects.toThrow();
    });

    it('rejects when the reader itself never arrives', async () => {
        const { loadWorkbookFromFile } = await freshLoader();

        const pending = loadWorkbookFromFile(await workbookFile('Contacts.xlsx', ['Contacts']));
        const rejection = expect(pending).rejects.toThrow();
        vendorScripts()[0].dispatchEvent(new Event('error'));
        await rejection;
    });
});

describe('loadExcelJs', () => {
    it('appends exactly one script and resolves when it loads', async () => {
        const { loadExcelJs } = await freshLoader();

        // Positive control: "no second script" would also be true of a module
        // that appends none at all, so the count is asserted BEFORE as well.
        expect(vendorScripts()).toHaveLength(0);

        const pending = loadExcelJs();
        expect(vendorScripts()).toHaveLength(1);
        expect(vendorScripts()[0].src).toContain(VENDOR_SRC);

        setGlobalExcelJs(ExcelJS);
        vendorScripts()[0].dispatchEvent(new Event('load'));

        await expect(pending).resolves.toBe(ExcelJS);
    });

    it('appends no second script for a second call', async () => {
        const { loadExcelJs } = await freshLoader();

        const first = loadExcelJs();
        const second = loadExcelJs();
        expect(vendorScripts()).toHaveLength(1);

        setGlobalExcelJs(ExcelJS);
        vendorScripts()[0].dispatchEvent(new Event('load'));

        await expect(first).resolves.toBe(ExcelJS);
        await expect(second).resolves.toBe(ExcelJS);
        expect(vendorScripts()).toHaveLength(1);
    });

    it('touches the DOM not at all when the library is already there', async () => {
        setGlobalExcelJs(ExcelJS);
        const { loadExcelJs } = await freshLoader();

        await expect(loadExcelJs()).resolves.toBe(ExcelJS);
        expect(vendorScripts()).toHaveLength(0);
    });

    it('rejects when the script fails to load', async () => {
        const { loadExcelJs } = await freshLoader();

        const pending = loadExcelJs();
        const rejection = expect(pending).rejects.toThrow(/vendor\/exceljs\.min\.js/);
        vendorScripts()[0].dispatchEvent(new Event('error'));
        await rejection;
    });

    it('rejects when the script loads but leaves no global behind', async () => {
        const { loadExcelJs } = await freshLoader();

        const pending = loadExcelJs();
        const rejection = expect(pending).rejects.toThrow();
        // No `setGlobalExcelJs` — a 200 that served the wrong file looks exactly
        // like this, and resolving `undefined` here would surface far away as a
        // "not a constructor" inside the panel.
        vendorScripts()[0].dispatchEvent(new Event('load'));
        await rejection;
    });
});
