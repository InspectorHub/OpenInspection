import { useState } from "react";
import { Form } from "react-router";
import { Banner, Button, Checkbox } from "@core/shared-ui";

import { m } from "~/paraglide/messages";
import {
    importStartBlockedReason,
    type ImportEntryPoint,
} from "~/lib/import-entry-points";
import { defaultImportSourceFor, importSourcesFor } from "~/lib/import-sources";
import { SourcePicker } from "./SourcePicker";

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

    const blockedReason = importStartBlockedReason(
        entry,
        {
            vendor,
            hasFile: fileName !== null,
            // This panel does not read workbooks yet, so the only honest answer
            // is that whatever was chosen is not one.
            workbook: "not-a-workbook",
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
                    data-testid="import-start-file"
                    type="file"
                    name="file"
                    accept=".csv,.xlsx,.json"
                    className="sr-only"
                    onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
                />
            </label>

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
