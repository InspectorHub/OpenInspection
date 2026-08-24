// @vitest-environment happy-dom
/**
 * The upload form, with a workbook in its hands.
 *
 * What is asserted here is what `new FormData(form).get('file')` holds — the
 * bytes that would actually be uploaded — and not what the component's state
 * says about itself. The whole design is that the server sees a CSV it already
 * knows how to read, so the only assertion that means anything is the one taken
 * off the form.
 *
 * The pair that carries the boundary rule is (1) and (2): the SAME workbook on
 * the contacts entry becomes a CSV and on the templates entry with `spectora`
 * declared stays an `.xlsx`. Either alone would pass for a panel with no rule
 * in it at all.
 *
 * `~/lib/xlsx-loader` is mocked so no script is injected and no vendored asset
 * is fetched — but what the mock hands back is a REAL workbook, parsed by the
 * real library from bytes the real library wrote. The conversion under test is
 * therefore the production one.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkbookLike } from "~/lib/xlsx-import";
import { loadWorkbookFromFile } from "~/lib/xlsx-loader";
import type { ImportEntryPoint } from "~/lib/import-entry-points";
import { StartImportPanel } from "./StartImportPanel";

vi.mock("~/lib/xlsx-loader", () => ({
    loadExcelJs: vi.fn(),
    loadWorkbookFromFile: vi.fn(),
}));

const mockedLoad = vi.mocked(loadWorkbookFromFile);

const CONTACTS: ImportEntryPoint = { intent: "contacts.import", readByPerson: false };
const TEMPLATES: ImportEntryPoint = { intent: "templates.create", readByPerson: false };

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface SheetSpec {
    name: string;
    rows: string[][];
}

const COVER: SheetSpec = { name: "Cover", rows: [["Exported by", "Acme"]] };
const CONTACTS_SHEET: SheetSpec = {
    name: "Contacts",
    rows: [["name", "email"], ["Alice Example", "alice@example.com"]],
};
const AGENTS_SHEET: SheetSpec = {
    name: "Agents",
    rows: [["name", "email"], ["Bob Example", "bob@example.com"]],
};

/** Real bytes from the real writer, plus the same bytes parsed back by the real
 *  reader — so the `File` in the input and the workbook the mocked loader
 *  returns are two views of one workbook, exactly as production has them. */
async function realWorkbook(fileName: string, sheets: SheetSpec[]): Promise<{ file: File; parsed: WorkbookLike }> {
    const wb = new ExcelJS.Workbook();
    for (const sheet of sheets) {
        const ws = wb.addWorksheet(sheet.name);
        for (const row of sheet.rows) ws.addRow(row);
    }
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(buffer);
    return {
        file: new File([buffer], fileName, { type: XLSX_TYPE }),
        parsed: parsed as unknown as WorkbookLike,
    };
}

function renderPanel(props: {
    entry: ImportEntryPoint;
    hasAssistedMigration?: boolean;
}): HTMLFormElement {
    // A router context, because the panel submits through `<Form>`. The panel
    // is still rendered DIRECTLY: no route module, no loader, no middleware —
    // `createRoutesStub` would not run middleware anyway, and there is nothing
    // here to authorise.
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <StartImportPanel
                    entry={props.entry}
                    label="Contacts"
                    hasAssistedMigration={props.hasAssistedMigration ?? true}
                    busy={false}
                    error={null}
                />
            ),
        },
    ]);
    const { container } = render(<Stub initialEntries={["/"]} />);
    const form = container.querySelector("form");
    if (!form) throw new Error("the panel rendered no form");
    return form;
}

function chooseFile(file: File): void {
    const input = screen.getByTestId("import-start-file") as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    fireEvent.change(input);
}

/** What would actually be uploaded. */
async function uploadedFile(form: HTMLFormElement): Promise<File> {
    const value = new FormData(form).get("file");
    if (!(value instanceof File)) throw new Error("the form carries no file");
    return value;
}

function blockedSentence(): string | null {
    return screen.queryByTestId("import-start-blocked")?.textContent ?? null;
}

beforeEach(() => {
    mockedLoad.mockReset();
});

describe("StartImportPanel — a workbook on an entry that reads tables", () => {
    it("asks which sheet, then swaps the workbook for that sheet as CSV", async () => {
        const { file, parsed } = await realWorkbook("contacts.xlsx", [COVER, CONTACTS_SHEET]);
        mockedLoad.mockResolvedValue(parsed);

        const form = renderPanel({ entry: CONTACTS });
        chooseFile(file);

        const select = (await screen.findByTestId("import-start-sheet")) as unknown as HTMLSelectElement;
        expect([...select.options].map((o) => o.textContent))
            .toEqual(["Choose a sheet", "Cover", "Contacts"]);
        expect(blockedSentence()).toBe("Choose which sheet holds the list.");

        fireEvent.change(select, { target: { value: "1" } });

        await waitFor(async () => {
            expect((await uploadedFile(form)).name).toMatch(/\.csv$/);
        });
        const uploaded = await uploadedFile(form);
        expect(await uploaded.text()).toBe("name,email\nAlice Example,alice@example.com");
        expect(uploaded.type).toBe("text/csv");
        expect(blockedSentence()).not.toBe("Choose which sheet holds the list.");
    });

    it("converts a re-picked sheet from the workbook it kept, not from the input", async () => {
        // The input holds the CSV after the first swap, so the workbook is gone
        // from it. This is the assertion that catches an implementation that
        // re-reads `input.files[0]`.
        const { file, parsed } = await realWorkbook("people.xlsx", [CONTACTS_SHEET, AGENTS_SHEET]);
        mockedLoad.mockResolvedValue(parsed);

        const form = renderPanel({ entry: CONTACTS });
        chooseFile(file);

        const select = (await screen.findByTestId("import-start-sheet")) as unknown as HTMLSelectElement;
        fireEvent.change(select, { target: { value: "0" } });
        await waitFor(async () => {
            expect(await (await uploadedFile(form)).text()).toContain("Alice Example");
        });

        fireEvent.change(select, { target: { value: "1" } });
        await waitFor(async () => {
            expect(await (await uploadedFile(form)).text())
                .toBe("name,email\nBob Example,bob@example.com");
        });
        // The loader ran once. A second parse would mean the workbook was not
        // kept, and the second conversion would be reading a CSV.
        expect(mockedLoad).toHaveBeenCalledTimes(1);
    });

    it("asks nothing and converts silently when only one sheet has rows", async () => {
        // Excel's own new workbook carries blank sheets. A radio group of one
        // is not a question, and neither is a select of one.
        const { file, parsed } = await realWorkbook("contacts.xlsx", [
            CONTACTS_SHEET,
            { name: "Sheet2", rows: [] },
        ]);
        mockedLoad.mockResolvedValue(parsed);

        const form = renderPanel({ entry: CONTACTS });
        chooseFile(file);

        expect(await screen.findByText('Using sheet "Contacts".')).toBeTruthy();
        expect(screen.queryByTestId("import-start-sheet")).toBeNull();
        const uploaded = await uploadedFile(form);
        expect(uploaded.name).toMatch(/\.csv$/);
        expect(await uploaded.text()).toBe("name,email\nAlice Example,alice@example.com");
    });
});

describe("StartImportPanel — the boundary rule", () => {
    it("leaves a workbook alone where the declared vendor reads containers", async () => {
        // 🔴 The positive control for the whole feature, and the pair that makes
        // the case above mean anything: the SAME workbook, on an entry whose
        // vendor opens the file as a package. Flattening one sheet of a
        // Spectora export would destroy it.
        const { file, parsed } = await realWorkbook("templates.xlsx", [COVER, CONTACTS_SHEET]);
        mockedLoad.mockResolvedValue(parsed);

        const form = renderPanel({ entry: TEMPLATES });
        fireEvent.click(screen.getByDisplayValue("spectora"));
        chooseFile(file);

        await waitFor(() => {
            expect(screen.getByTestId("import-start-file")).toBeTruthy();
        });
        expect(screen.queryByTestId("import-start-sheet")).toBeNull();
        expect(mockedLoad).not.toHaveBeenCalled();
        const uploaded = await uploadedFile(form);
        expect(uploaded.name).toBe("templates.xlsx");
        expect(uploaded.type).toBe(XLSX_TYPE);
    });

    it("leaves a CSV alone on the entry that does convert", async () => {
        // The other half of the rule: conversion is keyed on the vendor AND on
        // the file being a workbook. A plain CSV must reach the server as
        // itself, with nothing parsed and nothing swapped.
        const form = renderPanel({ entry: CONTACTS });
        chooseFile(new File(["name,email\nAlice,a@x.com"], "contacts.csv", { type: "text/csv" }));

        expect(mockedLoad).not.toHaveBeenCalled();
        expect(screen.queryByTestId("import-start-sheet")).toBeNull();
        expect((await uploadedFile(form)).name).toBe("contacts.csv");
    });
});

describe("StartImportPanel — the escape hatch", () => {
    it("uploads the original workbook, unblocked, when nothing here can read it", async () => {
        // 🔴 The most important arm in the feature. An unreadable workbook takes
        // the path it takes today: uploaded whole, recognised by no adapter,
        // handed to whoever converts such files. Blocking the submit here would
        // delete that path without changing a line of server code.
        const { file } = await realWorkbook("contacts.xlsx", [CONTACTS_SHEET]);
        mockedLoad.mockRejectedValue(new Error("not a workbook"));

        const form = renderPanel({ entry: CONTACTS });
        chooseFile(file);

        expect(await screen.findByText(/could not be read here/)).toBeTruthy();
        const uploaded = await uploadedFile(form);
        expect(uploaded.name).toBe("contacts.xlsx");
        expect(uploaded.type).toBe(XLSX_TYPE);
        // Not blocked BY THE WORKBOOK RULE. The keep-file agreement is still
        // outstanding, which is the sentence a person should see next.
        expect(blockedSentence()).toBe(
            "Agree to us keeping the file, so this import can be picked up again later.",
        );
    });

    it("says something different where there is nobody to hand the file to", async () => {
        // A self-hosted deployment has no support path: the server refuses the
        // upload rather than storing it, so "someone will convert it" would be
        // a promise nothing can keep.
        const { file } = await realWorkbook("contacts.xlsx", [CONTACTS_SHEET]);
        mockedLoad.mockRejectedValue(new Error("not a workbook"));

        renderPanel({ entry: CONTACTS, hasAssistedMigration: false });
        chooseFile(file);
        const standalone = (await screen.findByText(/could not be read here/)).textContent;

        mockedLoad.mockRejectedValue(new Error("not a workbook"));
        renderPanel({ entry: CONTACTS, hasAssistedMigration: true });
        const inputs = screen.getAllByTestId("import-start-file");
        const dt = new DataTransfer();
        dt.items.add(file);
        (inputs[1] as HTMLInputElement).files = dt.files;
        fireEvent.change(inputs[1]);

        await waitFor(() => {
            expect(screen.getAllByText(/could not be read here/)).toHaveLength(2);
        });
        const assisted = screen.getAllByText(/could not be read here/)[1].textContent;

        expect(standalone).not.toBe(assisted);
        expect(assisted).toMatch(/someone will convert it/);
        expect(standalone).toMatch(/CSV/);
    });
});

describe("the PDF route, for a source nothing here can read", () => {
    it("swaps the file chooser for the PDF surface, rather than adding a second one", async () => {
        // 🔴 The assertion that makes this a VARIANT and not an extra section.
        // Appending would leave two pickers on one screen — one accepting
        // `.csv,.xlsx,.json` and one accepting `application/pdf` — and the
        // operator would have to guess which is theirs. The negative half is
        // the load-bearing one: the sheet picker and the visible chooser label
        // must both be gone.
        renderPanel({ entry: TEMPLATES });
        fireEvent.click(screen.getByDisplayValue("homegauge"));

        await waitFor(() => {
            expect(screen.getByTestId("pdf-upload")).toBeTruthy();
        });
        expect(screen.getByTestId("blank-template-guidance")).toBeTruthy();
        expect(screen.getByTestId("user-processing-statement")).toBeTruthy();
        expect(screen.queryByTestId("import-start-choose-file")).toBeNull();
        expect(screen.queryByTestId("import-start-sheet")).toBeNull();
    });

    it("leaves the readable sources exactly as they were", async () => {
        // Positive control, and the only thing that makes the case above mean
        // anything: the SAME entry with a source that IS read here keeps its
        // own chooser and grows no statement.
        renderPanel({ entry: TEMPLATES });
        fireEvent.click(screen.getByDisplayValue("spectora"));

        await waitFor(() => {
            expect(screen.getByTestId("import-start-choose-file")).toBeTruthy();
        });
        expect(screen.queryByTestId("pdf-upload")).toBeNull();
        expect(screen.queryByTestId("user-processing-statement")).toBeNull();
    });

    it("puts the chosen PDF on the form, so the server receives the file itself", async () => {
        // The panel submits through one `<input name="file">`; the PDF surface
        // has a dropzone of its own that is not a form control. If the file is
        // not transferred, this screen collects a PDF and uploads nothing —
        // which is indistinguishable from working until the run is inspected.
        const form = renderPanel({ entry: TEMPLATES });
        fireEvent.click(screen.getByDisplayValue("homegauge"));
        await waitFor(() => expect(screen.getByTestId("user-processing-statement")).toBeTruthy());

        fireEvent.click(screen.getByTestId("user-processing-statement"));
        const pdf = new File(["%PDF-1.7"], "blank-template.pdf", { type: "application/pdf" });
        const dropzone = screen
            .getByTestId("pdf-upload")
            .querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(dropzone, { target: { files: [pdf] } });

        await waitFor(async () => {
            expect((await uploadedFile(form)).name).toBe("blank-template.pdf");
        });
        expect((await uploadedFile(form)).type).toBe("application/pdf");
    });
});
