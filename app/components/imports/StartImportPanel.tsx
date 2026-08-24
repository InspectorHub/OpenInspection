import { useRef, useState } from "react";
import { Form } from "react-router";
import { Banner, Button, Checkbox } from "@core/shared-ui";

import { m } from "~/paraglide/messages";
import {
    importStartBlockedReason,
    type ImportEntryPoint,
    type WorkbookStage,
} from "~/lib/import-entry-points";
import { defaultImportSourceFor, importSourcesFor, sourceIsTabular } from "~/lib/import-sources";
import { csvFileNameFor, isWorkbookFileName } from "~/lib/xlsx-intake";
import { sheetChoices, workbookSheetToCsv, type SheetChoice, type WorkbookLike } from "~/lib/xlsx-import";
import { loadWorkbookFromFile } from "~/lib/xlsx-loader";
import { SheetPicker } from "./SheetPicker";
import { SourcePicker } from "./SourcePicker";

/**
 * Where the chosen file has got to in the workbook question.
 *
 * Panel-internal, and one state richer than `WorkbookStage`: `ready` carries
 * the sheets to offer and which one is chosen, neither of which the blocked
 * reason has any use for. The mapping between the two is `stageOf` below.
 */
type WorkbookState =
    | { kind: "none" }
    | { kind: "reading" }
    | { kind: "ready"; sheets: SheetChoice[]; chosen: number | null }
    | { kind: "unreadable" };

function stageOf(state: WorkbookState): WorkbookStage {
    switch (state.kind) {
        case "none":
            return "not-a-workbook";
        case "reading":
            return "reading";
        case "unreadable":
            return "unreadable";
        case "ready":
            return state.chosen === null ? "pending" : "chosen";
    }
}

/**
 * The form that turns a file into an import run.
 *
 * A NATIVE form submission, not a fetcher. The file has to reach the server as
 * multipart, and the guarded submit this app uses everywhere else carries a
 * `Record<string, string>` — a `File` spread into one becomes nothing at all,
 * silently, which is how a working-looking upload sends an empty body. The
 * browser's own encoding is the thing that already knows how to do this, so
 * the input stays a real form control and the run's id comes back as a
 * redirect rather than as data this component has to act on.
 *
 * Which is also why the input is `sr-only` rather than `hidden`: it still has
 * to hold the chosen file when the form submits, and it still has to be
 * focusable. Only its APPEARANCE is replaced, by the label beside it.
 *
 * ── The workbook, and the three things not to undo ──────────────────────────
 * An `.xlsx` chosen here is parsed IN THE BROWSER and replaced, in this same
 * input, by one sheet of it as CSV. That is why the form stays a native
 * submission and why nothing downstream changes: the server, the mapping step
 * and the preview step receive a CSV they already know how to read.
 *
 * 1. The parsed workbook lives in a REF, not in state and not in the input.
 *    After the first swap the input holds the CSV, so the workbook is gone from
 *    it — changing the sheet has to re-convert from the ref, or it would be
 *    converting a CSV.
 * 2. Conversion is keyed on the DECLARED VENDOR, not on the file extension. A
 *    Spectora export is also an `.xlsx`, and the server opens it as a package
 *    itself; flattening one sheet of it would destroy it. `sourceIsTabular`
 *    answers this, and the entries where it is true have exactly one source, so
 *    the vendor cannot change after a file is chosen.
 * 3. A workbook nothing here can read is left ALONE, and the submit stays
 *    enabled. That file then travels exactly as it does today. Blocking it
 *    would remove that path from the product without changing a line of server
 *    code.
 *
 * The two agreements are separate controls because they authorise different
 * things with different lifetimes. Keeping the file is about resuming this
 * run; letting a person open it is about a third party's contact details being
 * read by our staff. One checkbox covering both would either over-ask
 * everybody or under-ask the case that matters.
 */
export function StartImportPanel({
    entry,
    label,
    hasAssistedMigration,
    busy,
    error,
}: {
    entry: ImportEntryPoint;
    /** What this entry brings over, already translated. */
    label: string;
    /** Whether this deployment has anybody to hand an unreadable file to. */
    hasAssistedMigration: boolean;
    busy: boolean;
    /** What the server said when the last attempt was refused, or null. */
    error: string | null;
}) {
    // Pre-answered ONLY where the entry accepts one kind of file; null wherever
    // there is a real choice, because a default there would be the rule this
    // picker exists to delete — the intent silently deciding the vendor.
    const [vendor, setVendor] = useState<string | null>(() => defaultImportSourceFor(entry.intent));
    const [fileName, setFileName] = useState<string | null>(null);
    const [uploadAuthorized, setUploadAuthorized] = useState(false);
    const [staffAccessAuthorized, setStaffAccessAuthorized] = useState(false);
    const [workbook, setWorkbook] = useState<WorkbookState>({ kind: "none" });

    const inputRef = useRef<HTMLInputElement>(null);
    /** The parsed workbook and the name it arrived under — see (1) above. */
    const heldRef = useRef<{ workbook: WorkbookLike; fileName: string } | null>(null);
    /** Which read is current. A second file chosen while the first is still
     *  parsing must not have its result overwritten by the one it replaced. */
    const readRef = useRef(0);

    /** Put one sheet of the held workbook into the file input, as CSV. */
    const applySheet = (sheetIndex: number, sheetName: string) => {
        const held = heldRef.current;
        const input = inputRef.current;
        if (!held || !input) return;
        const csv = workbookSheetToCsv(held.workbook, sheetIndex);
        const converted = new File([csv], csvFileNameFor(held.fileName, sheetName), {
            type: "text/csv",
        });
        // Assigning `files` does not fire `change`, so this cannot re-enter the
        // handler below.
        const transfer = new DataTransfer();
        transfer.items.add(converted);
        input.files = transfer.files;
    };

    const onFileChosen = (file: File | null) => {
        // Always starts from the newly chosen file, so choosing a second one
        // resets every answer the first produced.
        const read = ++readRef.current;
        heldRef.current = null;
        setFileName(file?.name ?? null);

        if (!file || !sourceIsTabular(entry.intent, vendor) || !isWorkbookFileName(file.name)) {
            setWorkbook({ kind: "none" });
            return;
        }

        setWorkbook({ kind: "reading" });
        loadWorkbookFromFile(file)
            .then((parsed) => {
                if (read !== readRef.current) return;
                const sheets = sheetChoices(parsed);
                // No sheet with rows is a parse failure by another name: every
                // answer on offer would convert to an empty CSV.
                if (sheets.length === 0) {
                    setWorkbook({ kind: "unreadable" });
                    return;
                }
                heldRef.current = { workbook: parsed, fileName: file.name };
                if (sheets.length === 1) {
                    applySheet(sheets[0].index, sheets[0].name);
                    setWorkbook({ kind: "ready", sheets, chosen: sheets[0].index });
                } else {
                    setWorkbook({ kind: "ready", sheets, chosen: null });
                }
            })
            .catch(() => {
                // Every failure means the same thing: leave the input alone, so
                // the original workbook is what submits. See (3) above.
                if (read !== readRef.current) return;
                setWorkbook({ kind: "unreadable" });
            });
    };

    const blockedReason = importStartBlockedReason(
        entry,
        {
            vendor,
            hasFile: fileName !== null,
            workbook: stageOf(workbook),
            uploadAuthorized,
            staffAccessAuthorized,
        },
        {
            needsSource: m.imports_start_needs_source(),
            needsFile: m.imports_upload_needs_file(),
            readingWorkbook: m.imports_upload_reading_workbook(),
            needsSheet: m.imports_upload_needs_sheet(),
            needsUploadAuthorized: m.imports_upload_needs_authorize(),
            needsStaffAccessAuthorized: m.imports_upload_needs_staff_authorize(),
        },
    );

    return (
        <Form method="post" encType="multipart/form-data" className="space-y-4">
            <input type="hidden" name="intent" value={entry.intent} />

            {/* The panel is titled by what it imports: the entry point is the
                only thing that decides what this file will become. */}
            <h3
                data-testid="import-start-intent"
                className="text-[15px] font-bold text-ih-fg-1"
            >
                {label}
            </h3>

            {/* Which product, before which file. It decides which reader runs,
                and the sentence under the submit control names it first. */}
            <SourcePicker
                intent={entry.intent}
                value={vendor}
                hasAssistedMigration={hasAssistedMigration}
                onPick={setVendor}
            />
            {/* The picker renders nothing where the entry accepts one kind of
                file, so the settled declaration still has to reach the request
                — a form that sent no vendor would put the server back in the
                business of guessing one. */}
            {importSourcesFor(entry.intent).length < 2 && vendor && (
                <input type="hidden" name="vendor" value={vendor} />
            )}

            <label className="block">
                <span className="inline-flex items-center gap-3">
                    <span className={fileChooserClass}>{m.imports_upload_choose_file()}</span>
                    <span className="text-[11px] text-ih-fg-3">
                        {fileName ?? m.imports_upload_hint()}
                    </span>
                </span>
                <input
                    ref={inputRef}
                    data-testid="import-start-file"
                    type="file"
                    name="file"
                    accept=".csv,.xlsx,.json"
                    className="sr-only"
                    onChange={(e) => onFileChosen(e.currentTarget.files?.[0] ?? null)}
                />
            </label>

            {/* Nothing at all below two sheets — see SheetPicker. */}
            {workbook.kind === "ready" && (
                <SheetPicker
                    sheets={workbook.sheets}
                    value={workbook.chosen}
                    onPick={(sheetIndex) => {
                        const sheet = workbook.sheets.find((s) => s.index === sheetIndex);
                        if (!sheet) return;
                        applySheet(sheet.index, sheet.name);
                        setWorkbook({ ...workbook, chosen: sheet.index });
                    }}
                />
            )}

            {/* One sheet: information, not a question. */}
            {workbook.kind === "ready" && workbook.sheets.length === 1 && (
                <p data-testid="import-start-sheet-used" className="text-[12px] text-ih-fg-3">
                    {m.imports_sheet_using({ name: workbook.sheets[0].name })}
                </p>
            )}

            {/* The two sentences differ because the outcomes differ: a
                deployment with no support path refuses the upload rather than
                storing it, so "someone will convert it" would be a promise
                nothing can keep. */}
            {workbook.kind === "unreadable" && (
                <p data-testid="import-start-sheet-unreadable" className="text-[12px] text-ih-fg-3">
                    {hasAssistedMigration
                        ? m.imports_sheet_unreadable_assisted()
                        : m.imports_sheet_unreadable_standalone()}
                </p>
            )}

            {/* Offered HERE, and only for contacts: the failure a starter file
                removes is a whole upload whose headings nothing matched, and
                the moment to prevent that is the moment before a file is
                chosen. The other entry points read different columns, so the
                same file there would teach the wrong format.

                Its columns are derived from the importer's own header
                vocabulary — see server/lib/migration-intake/contacts-template.ts
                — so this link can never advertise a format the parser stopped
                accepting. */}
            {entry.intent === "contacts.import" && (
                <p className="text-[12px]">
                    <a
                        data-testid="import-start-template"
                        href="/resources/contacts-template"
                        download
                        className="font-bold text-ih-primary-text hover:underline"
                    >
                        {m.imports_download_template()}
                    </a>
                </p>
            )}

            <div className="space-y-1">
                <Checkbox
                    data-testid="import-start-authorize"
                    name="uploadAuthorized"
                    value="true"
                    checked={uploadAuthorized}
                    onChange={(e) => setUploadAuthorized(e.currentTarget.checked)}
                    label={m.imports_upload_authorize()}
                />
                <p className="text-[11px] text-ih-fg-3 pl-6">{m.imports_upload_authorize_help()}</p>
            </div>

            {entry.readByPerson && (
                <div className="space-y-1">
                    <Checkbox
                        data-testid="import-start-staff-authorize"
                        name="staffAccessAuthorized"
                        value="true"
                        checked={staffAccessAuthorized}
                        onChange={(e) => setStaffAccessAuthorized(e.currentTarget.checked)}
                        label={m.imports_upload_staff_authorize()}
                    />
                    <p className="text-[11px] text-ih-fg-3 pl-6">
                        {m.imports_upload_staff_authorize_help()}
                    </p>
                </div>
            )}

            {error && <Banner tone="danger">{error}</Banner>}

            <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" disabled={blockedReason !== null || busy}>
                    {m.imports_upload_submit()}
                </Button>
                {/* Rendered only when it has something to say. An always-present
                    line reading "" is a layout jump, and an always-present line
                    reading "Ready" is a second thing to keep true. */}
                {blockedReason && (
                    <p data-testid="import-start-blocked" className="text-[12px] text-ih-fg-3">
                        {blockedReason}
                    </p>
                )}
            </div>
        </Form>
    );
}

/** The label that stands in for the file input's own chrome. Same rank as a
 *  secondary button, because that is what it is. */
const fileChooserClass =
    "h-9 px-4 rounded-ih-button border border-ih-border bg-ih-bg-card text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center cursor-pointer";
