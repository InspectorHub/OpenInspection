import { useId, useRef, useState } from "react";
import { Form } from "react-router";
import { Banner, Button, Checkbox } from "@core/shared-ui";

import { m } from "~/paraglide/messages";
import { PdfInferenceUpload } from "./PdfInferenceUpload";
import { importStartBlockedReason, type ImportEntryPoint } from "~/lib/import-entry-points";
import {
    defaultImportSourceFor,
    importSourcesFor,
    sourceIsTabular,
    sourceNeedsPdfInference,
} from "~/lib/import-sources";
import { csvFileNameFor, isWorkbookFileName } from "~/lib/xlsx-intake";
import { sheetChoices, workbookSheetToCsv, type WorkbookLike } from "~/lib/xlsx-import";
import { loadWorkbookFromFile } from "~/lib/xlsx-loader";
import { SheetPicker } from "./SheetPicker";
import { stageOf, type WorkbookState } from "./workbook-state";
import { SourcePicker } from "./SourcePicker";

/**
 * Where each entry point's starter spreadsheet lives. A map rather than a
 * condition: "does this entry point have a template" and "which one" have the
 * same answer and should be read from one place. An intent absent here has
 * none — the right answer for a template import, whose input is a vendor
 * export rather than a spreadsheet somebody fills in.
 */
const TEMPLATE_DOWNLOAD_PATHS: Readonly<Record<string, string>> = {
    "contacts.import": "/resources/contacts-template",
    "members.invite": "/resources/members-template",
};

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
    /** What the operator said they did to the file before uploading it. Only
     *  the PDF route asks — see the warning on `ImportStartDraft.statementAccepted`
     *  about why this is not called an attestation. */
    const [statementAccepted, setStatementAccepted] = useState(false);
    const fileInputId = useId();

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

    /** Put the PDF the dropzone collected into the form's own file input.
     *  The dropzone is not a form control, so without this the screen would
     *  collect a file and upload nothing — which looks like it worked until
     *  somebody opens the run. */
    const applyPdf = (file: File) => {
        const input = inputRef.current;
        if (!input) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        // Assigning `files` does not fire `change`, so this cannot re-enter
        // `onFileChosen` behind the explicit call beside it.
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

    /** Whether the declared source takes the PDF route. One predicate, read in
     *  two places: it decides which half of the panel renders, and it decides
     *  whether the ladder asks for the statement. */
    const needsPdf = sourceNeedsPdfInference(entry.intent, vendor);

    const blockedReason = importStartBlockedReason(
        entry,
        {
            vendor,
            hasFile: fileName !== null,
            workbook: stageOf(workbook),
            statementAccepted,
            uploadAuthorized,
            staffAccessAuthorized,
        },
        {
            needsSource: m.imports_start_needs_source(),
            needsFile: m.imports_upload_needs_file(),
            needsPdfFile: m.imports_upload_needs_pdf_file(),
            readingWorkbook: m.imports_upload_reading_workbook(),
            needsSheet: m.imports_upload_needs_sheet(),
            needsStatement: m.imports_upload_needs_statement(),
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

            {/* The form's ONE carrier, outside both branches.
                Every route below submits through this input, whatever control
                the operator actually touched — the PDF surface has a dropzone
                of its own that is not a form control, so its file is copied in
                here. Two inputs would mean two things could be submitted and
                only one of them was the file on screen. */}
            <input
                ref={inputRef}
                id={fileInputId}
                data-testid="import-start-file"
                type="file"
                name="file"
                accept={needsPdf ? "application/pdf,.pdf" : ".csv,.xlsx,.json"}
                className="sr-only"
                onChange={(e) => onFileChosen(e.currentTarget.files?.[0] ?? null)}
            />

            {needsPdf ? (
                /* A VARIANT of this half of the panel, not a section appended
                   to it. The PDF route is a different upload contract: another
                   accept type, a statement that must be answered BEFORE the
                   picker opens, and a result that can send the operator back
                   for a different file. Rendered alongside the chooser below,
                   the screen would carry two pickers and the operator would
                   have to guess which one is theirs. */
                <PdfInferenceUpload
                    scanResult={null}
                    statementAccepted={statementAccepted}
                    onStatementChange={setStatementAccepted}
                    fileName={fileName}
                    busy={busy}
                    onFile={(file) => {
                        applyPdf(file);
                        onFileChosen(file);
                    }}
                />
            ) : (
                /* The text sits DIRECTLY under the label rather than in a
                   wrapper span: the input moved out of the label when it became
                   the shared carrier for both routes, so the association is now
                   `htmlFor`, and a11y linting reads the label's own text at a
                   bounded depth. Wrapped one level deeper it reported the label
                   as having no accessible text — which is what a screen reader
                   would have found too. */
                <label
                    htmlFor={fileInputId}
                    data-testid="import-start-choose-file"
                    className="flex items-center gap-3 cursor-pointer"
                >
                    <span className={fileChooserClass}>{m.imports_upload_choose_file()}</span>
                    <span className="text-[11px] text-ih-fg-3">
                        {fileName ?? m.imports_upload_hint()}
                    </span>
                </label>
            )}

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

            {/* Offered HERE: the failure a starter file removes is a whole
                upload whose headings nothing matched, and the moment to prevent
                that is the moment before a file is chosen.

                ONE TEMPLATE PER ENTRY POINT, never one shared file — they read
                different columns, so a shared file would teach one of them the
                wrong format. Each is derived from its own entity manifest (see
                server/lib/migration-intake/starter-template.ts), which is both
                why a second one became possible and why neither can advertise a
                format the parser stopped accepting. */}
            {TEMPLATE_DOWNLOAD_PATHS[entry.intent] && (
                <p className="text-[12px]">
                    <a
                        data-testid="import-start-template"
                        href={TEMPLATE_DOWNLOAD_PATHS[entry.intent]}
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
