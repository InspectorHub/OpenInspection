import { RadioCardGroup } from "@core/shared-ui";

import type { ImportEntryIntent } from "~/lib/import-entry-points";
import { importSourcesFor, asImportSource } from "~/lib/import-sources";
import type { VendorId } from "../../../server/lib/migration-intake/bundle";
import { m } from "~/paraglide/messages";

/**
 * Which product this export came from.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * The intent used to decide the vendor, so `templates.create` meant Spectora
 * and a Home Inspector Pro file was answered with "nothing could read that".
 * The declaration turns that into "this is not what you said it was", which is
 * a sentence the operator can act on.
 *
 * ── The two things every row has to say ─────────────────────────────────────
 * WHICH FILE, AND WHERE IT LIVES. Not knowing that is the earliest and
 * quietest failure in the whole flow: the wrong file is exported, uploaded,
 * and refused, and nothing on the way told anybody what to export instead.
 *
 * WHAT HAPPENS NEXT, INCLUDING WHEN IT IS SLOW. A product with no reader here
 * goes to a person, and that path is measured in working days. Saying so on
 * the picker beats saying it after the file has been handed over — and the
 * sentence changes again where the deployment has nobody to hand it to, which
 * is a refusal rather than a wait.
 *
 * The "how long" copy for a product WITH a reader used to state no number,
 * because nobody had measured a real conversion in workerd and an invented
 * duration is worse than none. It has now been measured (2026-08-25), against
 * real vendor exports, in real workerd rather than Node:
 *
 *   · a 1873-row by 42-column spreadsheet export -> 43 ms median
 *   · a 357-item template archive                ->  9 ms median
 *
 * Both are medians of seven runs; the numbers, the file hashes they were taken
 * against, the method and a measured linear scaling curve live in
 * `tests/fixtures/intake/manifest.json` under `measurements` and `scaling`.
 * Node was measured on the same bytes and over-reported by 1.5x and 2.6x —
 * so the familiar "Node is about 2.5x" is workload-dependent, not a factor you
 * can divide by.
 *
 * ⚠️ WHY THE COPY SAYS A SCALE AND NOT THE NUMBER. 43 ms is our end of it. What
 * the operator actually waits through is their own upload of a file that runs to
 * hundreds of kilobytes, which we neither measure nor control, so a figure would
 * be precise about the wrong quantity. "Seconds, not minutes" is true of the
 * whole wait and answers the question §3.2b is really asking — which is whether
 * this is the kind of wait you sit through.
 *
 * ⚠️ AND WHY IT STILL SAYS TO STAY. §3.2b attaches "you can leave this page" to
 * a path taking more than a few seconds. This one does not, and the invitation
 * would be actively wrong here: the file is read INSIDE the upload request, so
 * leaving loses the import. The absence is asserted, not just omitted.
 *
 * ── Native form field ───────────────────────────────────────────────────────
 * The radios carry `name="vendor"`, so the declaration reaches the server
 * through the browser's own multipart encoding rather than through a second
 * piece of state that could disagree with what is on screen.
 */
export function SourcePicker({
    intent,
    value,
    hasAssistedMigration,
    onPick,
}: {
    intent: ImportEntryIntent;
    /** The declaration so far, or null while there is none. */
    value: string | null;
    /**
     * Whether this deployment has anybody to hand an unreadable file to.
     *
     * A property of the DEPLOYMENT, not of the file. Where it is false the
     * upload is refused before anything is stored, so a row promising a
     * conversion by hand would be a door onto a wall.
     */
    hasAssistedMigration: boolean;
    onPick: (vendor: VendorId) => void;
}) {
    const sources = importSourcesFor(intent);
    // Nothing to ask. Either the entry point accepts one kind of file and has
    // already answered, or it is the entry for a file whose owner could not
    // name the product — where asking is the guess that entry exists to avoid.
    if (sources.length < 2) return null;

    return (
        <RadioCardGroup
            name="vendor"
            legend={m.imports_source_pick_legend()}
            value={value ?? ""}
            onChange={(picked) => {
                // Narrowed against the offered list rather than cast: the value
                // decides which reader runs, and this component's own options
                // are the only ones this entry point accepts.
                const vendor = asImportSource(intent, picked);
                if (vendor) onPick(vendor);
            }}
            options={sources.map((source) => ({
                value: source.vendor,
                title: VENDOR_NAME[source.vendor](),
                description: (
                    <>
                        {VENDOR_FILE[source.vendor]()}{" "}
                        {source.readHere ? (
                            m.imports_source_read_here()
                        ) : (
                            /* BOTH sentences, and the order is the design.
                               The existing one first, because it carries a
                               disclosed commitment — a person, and how long
                               they take — that a faster option must not be
                               allowed to quietly replace. The PDF line is
                               added AFTER it as an alternative, not instead
                               of it.
                               It has to be here at all because the panel below
                               now offers that route: before this line existed,
                               the selected card said "export a spreadsheet
                               instead" while the panel underneath asked for a
                               printed PDF, and both were visible in one
                               screenshot. Every unit test in this directory
                               passed on that screen. */
                            <>
                                {hasAssistedMigration
                                    ? m.imports_source_read_by_person()
                                    : m.imports_source_read_by_nobody()}{" "}
                                {m.imports_source_read_by_pdf()}
                            </>
                        )}
                    </>
                ),
            }))}
        />
    );
}

/**
 * What each product is called, and which of its files to send.
 *
 * Keyed by vendor and written out rather than templated, because a message key
 * has to be a literal for the catalogue to find it — and because the answer
 * genuinely differs per product: one exports a spreadsheet from a screen, one
 * keeps a container in a folder on disk, and one is a file type in a folder
 * under Documents.
 */
const VENDOR_NAME: Record<VendorId, () => string> = {
    spectora: m.imports_source_vendor_spectora,
    home_inspector_pro: m.imports_source_vendor_home_inspector_pro,
    homegauge: m.imports_source_vendor_homegauge,
    csv_generic: m.imports_source_vendor_csv_generic,
};

const VENDOR_FILE: Record<VendorId, () => string> = {
    spectora: m.imports_source_file_spectora,
    home_inspector_pro: m.imports_source_file_home_inspector_pro,
    homegauge: m.imports_source_file_homegauge,
    csv_generic: m.imports_source_file_csv_generic,
};
