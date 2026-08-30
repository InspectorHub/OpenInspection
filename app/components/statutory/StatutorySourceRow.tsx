import { useId, useState } from "react";
import { Form } from "react-router";
import { Banner, Button, Card, Pill, formatFileSize } from "@core/shared-ui";

import { formatDate } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * What the screen knows about one published revision. Mirrors the row shape of
 * `GET /api/admin/statutory-forms` rather than importing it, because the loader
 * is the boundary the JSON crosses and a type shared across it would let a
 * server-only field become a client render by accident.
 */
export interface StatutorySourceRowData {
    formId: string;
    revision: string;
    sourceHash: string;
    sourceUrl: string;
    effectiveFrom: number;
    mandatoryFrom: number | null;
    effectiveUntil: number | null;
    withdrawn: { at: number; reason: string } | null;
    present: boolean;
    sizeBytes: number | null;
    uploadedAt: number | null;
}

/**
 * One revision, and the upload that supplies its PDF.
 *
 * ── WHY A NATIVE FORM AND NOT A GUARDED FETCHER ─────────────────────────────
 * The same reason `StartImportPanel` gives, and it is worth repeating where the
 * next person will read it: this app's guarded submit carries a
 * `Record<string, string>`, and a `File` spread into one becomes nothing at
 * all — silently. The browser's own multipart encoding is the thing that knows
 * how to send a file, so the input stays a real form control inside a real
 * `<Form>`. Double submission is contained the way a native form contains it:
 * the button is disabled while this row's own request is in flight, and the
 * write itself is idempotent by construction (the server admits exactly one
 * sequence of bytes for this revision, so a second upload can only overwrite
 * them with themselves).
 *
 * ── WHY THE REFUSAL IS RENDERED VERBATIM ────────────────────────────────────
 * The server's refusal names this file's sha256, the one this revision records,
 * the fact that the revision is printed inside the document, and where the
 * authority publishes it. That paragraph IS the remedy. An operator standing in
 * a downloads folder with four files called `form.pdf` and a banner reading
 * "Upload failed" has been told to guess. So `serverError` is printed as it
 * arrived, and the local sentence below it is used only when the server wrote
 * nothing of its own. It arrives in English, because it is composed in server
 * code and is not in the message catalogue; an instruction a reader can act on
 * beats a translated sentence they cannot.
 */
export function StatutorySourceRow({
    row,
    locale,
    timeZone,
    busy,
    result,
}: {
    row: StatutorySourceRowData;
    locale: string;
    timeZone: string;
    /** True only while THIS row's upload is in flight. */
    busy: boolean;
    /** What the last attempt on this row produced, or null if there was none. */
    result: { ok: true } | { ok: false; serverError: string | null } | null;
}) {
    const fileInputId = useId();
    const headingId = useId();
    const [fileName, setFileName] = useState<string | null>(null);

    const day = (value: number) => formatDate(new Date(value), { locale, timeZone });

    return (
        // A `section` around the card rather than props on the card: `Card` is a
        // presentational box and takes neither a test id nor a label, and each
        // revision really is a landmark of its own — a screen reader moving by
        // region lands on "tx_trec_rei · 7-6" instead of on an unnamed group.
        <section
            data-testid={`statutory-source-${row.formId}-${row.revision}`}
            aria-labelledby={headingId}
        >
        <Card className="p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 id={headingId} className="text-[15px] font-bold text-ih-fg-1">
                    {row.formId} · {row.revision}
                </h3>
                {/* The presence pill is the whole point of the row, so it is
                    first and it is never absent — a row with no pill would read
                    as "no answer yet" rather than as "not stored". */}
                <Pill tone={row.present ? "sat" : "warning"}>
                    {row.present ? m.statutory_source_present() : m.statutory_source_absent()}
                </Pill>
                {row.withdrawn && <Pill tone="neutral">{m.statutory_source_withdrawn()}</Pill>}
            </div>

            <p className="text-[12px] text-ih-fg-3">{dateLine(row, day)}</p>

            {row.present ? (
                <p className="text-[12px] text-ih-fg-3">
                    {m.statutory_source_present_detail({
                        size: row.sizeBytes === null ? "—" : formatFileSize(row.sizeBytes),
                        date: row.uploadedAt === null ? "—" : day(row.uploadedAt),
                    })}
                </p>
            ) : (
                /* Said only when it is true. A stored revision needs no
                   explanation of what an unstored one would cost. */
                <p className="text-[12px] text-ih-fg-3">{m.statutory_source_absent_detail()}</p>
            )}

            <dl className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-3">
                        {m.statutory_source_hash_label()}
                    </dt>
                    {/* Selectable and wrapping: an operator compares it against
                        what their own checksum tool printed, and a truncated
                        hash cannot be compared at all. */}
                    <dd className="text-[11px] font-mono break-all text-ih-fg-2">{row.sourceHash}</dd>
                </div>
            </dl>

            <p className="text-[12px]">
                {/* The authority's page, not a fetch. `noreferrer` as well as
                    `noopener` — this is a government site and it has no
                    business learning which deployment sent the operator. */}
                <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-ih-primary-text hover:underline break-all"
                >
                    {m.statutory_source_publisher()}
                </a>
            </p>

            {result?.ok === true && (
                <Banner tone="success">
                    {m.statutory_source_ok({ revision: row.revision, formId: row.formId })}
                </Banner>
            )}
            {/* `overflow-wrap:anywhere` on the failure banner: it relays the
                SERVER's sentence, which names the authority's publication URL,
                and a URL has no spaces to wrap at. Measured at a 390px viewport
                on the sibling marketplace refusal: the page body scrolled to
                457px against a 390px client width. */}
            {result?.ok === false && (
                <Banner tone="danger" className="[overflow-wrap:anywhere]">
                    {/* Normal weight inside the banner, which is semibold by
                        default. That default is right for the one-line
                        failures it usually carries; this one is a paragraph,
                        and five lines of bold red is a wall a reader skims
                        past — which would defeat the point of relaying it. */}
                    <span className="font-normal">
                        {result.serverError ?? m.statutory_source_failed()}
                    </span>
                </Banner>
            )}

            <Form method="post" encType="multipart/form-data" className="space-y-3">
                {/* Both identify the target, and both travel in the BODY. The
                    revision label is the authority's own and contains slashes
                    in the general case (`Rev. 04/26`), which a path segment
                    does not survive — see the route module's header. */}
                <input type="hidden" name="formId" value={row.formId} />
                <input type="hidden" name="revision" value={row.revision} />

                {/* `sr-only`, not `hidden`: it still has to carry the chosen
                    file when the form submits, and it still has to be
                    focusable. Only its appearance is replaced by the label. */}
                <input
                    id={fileInputId}
                    data-testid="statutory-source-file"
                    type="file"
                    name="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
                />

                <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor={fileInputId} className={fileChooserClass}>
                        {m.statutory_source_choose_file()}
                    </label>
                    <span className="text-[11px] text-ih-fg-3">
                        {fileName ?? m.statutory_source_no_file()}
                    </span>
                </div>

                <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? m.statutory_source_submitting() : m.statutory_source_submit()}
                </Button>
            </Form>
        </Card>
        </section>
    );
}

/**
 * The revision's own window, in one sentence.
 *
 * Four keys rather than one assembled from fragments: `mandatoryFrom` and
 * `effectiveUntil` are independently nullable, and a sentence stitched together
 * from clauses translates into Spanish as a sentence nobody would write.
 */
function dateLine(row: StatutorySourceRowData, day: (value: number) => string): string {
    const from = day(row.effectiveFrom);
    if (row.mandatoryFrom !== null && row.effectiveUntil !== null) {
        return m.statutory_source_dates_mandatory_until({
            from, mandatory: day(row.mandatoryFrom), until: day(row.effectiveUntil),
        });
    }
    if (row.mandatoryFrom !== null) {
        return m.statutory_source_dates_mandatory({ from, mandatory: day(row.mandatoryFrom) });
    }
    if (row.effectiveUntil !== null) {
        return m.statutory_source_dates_until({ from, until: day(row.effectiveUntil) });
    }
    return m.statutory_source_dates({ from });
}

/** Stands in for the file input's own chrome — same rank as a secondary
 *  button, because that is what it is. Matches `StartImportPanel`'s. */
const fileChooserClass =
    "h-9 px-4 rounded-ih-button border border-ih-border bg-ih-bg-card text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center cursor-pointer";
