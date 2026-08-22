import { useId } from "react";
import { Banner, Checkbox, FileDropzone } from "@core/shared-ui";

import { m } from "~/paraglide/messages";
import type { PiiCategory, PiiHit } from "../../../server/lib/migration-intake/pii-scan";

/**
 * The upload for a product nothing here can read, where the structure is
 * derived from a PDF the operator supplies.
 *
 * ── The order of this screen is the design ──────────────────────────────────
 * The blank template comes FIRST, above the file picker, because the failure
 * this screen exists to prevent is somebody sending a finished report. A
 * finished report carries a client, an address and a signature; a blank
 * template carries headings. Guidance placed under the picker is guidance read
 * after the file was chosen, which is too late to change which file it is.
 *
 * ── Three pieces of copy that must not be "tightened" ───────────────────────
 *
 * 1. THE STATEMENT IS NOT AN ATTESTATION, and the field name is where that
 *    lives: `userProcessingStatement`. Named `attestation`, the next engineer
 *    reads the control as "the customer accepted the risk", writes the next
 *    feature against that reading, and the screen quietly becomes a waiver.
 *    It is not one. It records what the operator says they did.
 *
 * 2. A CLEAN SCAN NEVER SAYS THE FILE IS CLEAN. "Nothing found" on its own is
 *    insufficient, because a reader takes it for a verdict — and this check is
 *    a pattern match over extracted text, which cannot see a name with no
 *    label beside it, an unusual address format, or anything inside an image.
 *    The limitation therefore travels in the SAME element as the result rather
 *    than in a footnote, so no future layout change can separate them.
 *
 * 3. A HIT REPORTS A PAGE AND A KIND. Never the matched text. Echoing it would
 *    copy the personal information into this interface, into any screenshot of
 *    it, into the logs and into any error report that quotes them — while
 *    refusing the file for containing that very thing. `PiiHit` has no field
 *    that could carry the text, so this component cannot render it however it
 *    is written; the sentence about the omission exists so the next person
 *    does not "improve" the type.
 *
 * ── What this component does NOT do ─────────────────────────────────────────
 * It never offers to fix the file. There is no "remove these for me" control
 * and there must not be one: a remover that misses something has issued a
 * clean bill of health for a file that is not clean, and we would be the party
 * that issued it. Refusing leaves the operator holding the decision they are
 * the only ones in a position to make.
 */

/** What the scan found, or `null` while nothing has been scanned yet. */
export interface PdfScanResult {
    hits: readonly PiiHit[];
}

/** How each kind of finding is named to the operator. Written out per category
 *  rather than templated, because a message key has to be a literal for the
 *  catalogue to find it — and because a shared sentence would be the "one
 *  sentence repeated under three headings" failure the source picker already
 *  guards against. */
const KIND_LABEL: Record<PiiCategory, () => string> = {
    name: m.imports_pdf_kind_name,
    email: m.imports_pdf_kind_email,
    phone: m.imports_pdf_kind_phone,
    address: m.imports_pdf_kind_address,
    signature: m.imports_pdf_kind_signature,
    licence: m.imports_pdf_kind_licence,
};

export function PdfInferenceUpload({
    scanResult,
    statementAccepted = false,
    onStatementChange,
    onFile,
    fileName = null,
    busy = false,
    error = null,
}: {
    /** The scan's outcome, or null before a file has been read. */
    scanResult: PdfScanResult | null;
    statementAccepted?: boolean;
    onStatementChange?: (accepted: boolean) => void;
    onFile?: (file: File) => void;
    fileName?: string | null;
    busy?: boolean;
    error?: string | null;
}) {
    const statementId = useId();

    return (
        <div className="space-y-4">
            {/* FIRST, and above the picker. See the note on ordering above. */}
            <section data-testid="blank-template-guidance" className="space-y-1">
                <h3 className="text-[15px] font-bold text-ih-fg-1">
                    {m.imports_pdf_blank_title()}
                </h3>
                <p className="text-[13px] text-ih-fg-2">{m.imports_pdf_blank_body()}</p>
                <p className="text-[13px] text-ih-fg-2">{m.imports_pdf_blank_how()}</p>
            </section>

            {/* `bare` plus an explicit `htmlFor`, rather than the component's
                own wrapping label: the statement is a sentence, not a word, and
                an explicit association is the one a test can see. A label whose
                target does not exist renders identically to one that works. */}
            <div className="flex items-start gap-2">
                <Checkbox
                    bare
                    id={statementId}
                    name="userProcessingStatement"
                    data-testid="user-processing-statement"
                    className="mt-1"
                    checked={statementAccepted}
                    onChange={(e) => onStatementChange?.(e.target.checked)}
                />
                <label htmlFor={statementId} className="text-[13px] text-ih-fg-2 cursor-pointer">
                    {m.imports_pdf_statement()}
                </label>
            </div>

            <div data-testid="pdf-upload">
                <FileDropzone
                    accept="application/pdf,.pdf"
                    hint={m.imports_pdf_upload_hint()}
                    fileName={fileName}
                    busy={busy}
                    error={error}
                    disabled={!statementAccepted}
                    onFile={(file) => onFile?.(file)}
                />
            </div>

            {scanResult && <ScanResult hits={scanResult.hits} />}
        </div>
    );
}

/**
 * The scan's outcome, as ONE element.
 *
 * The result and its limitation share a `data-testid` deliberately: they are a
 * single statement, and a layout that separated them would leave "nothing was
 * found" standing on its own somewhere on the page.
 *
 * `warn` rather than `success` on the clean arm, and that is not decoration.
 * A green tick is read as a pass, and nothing here passed anything — the file
 * merely did not match the patterns. `warn` is also the tone whose live region
 * asserts itself, which is correct for both arms: the operator is being told
 * something they have to act on either way.
 */
function ScanResult({ hits }: { hits: readonly PiiHit[] }) {
    if (hits.length === 0) {
        return (
            <Banner tone="warn">
                <div data-testid="scan-result" className="space-y-1">
                    <p>{m.imports_pdf_scan_clean_headline()}</p>
                    <p className="font-medium">{m.imports_pdf_scan_clean_limit()}</p>
                </div>
            </Banner>
        );
    }

    return (
        <Banner tone="danger">
            <div data-testid="scan-result" className="space-y-1">
                <p>{m.imports_pdf_scan_found_headline()}</p>
                <p>{m.imports_pdf_scan_found_intro()}</p>
                <ul className="list-disc pl-5">
                    {hits.map((hit) => (
                        <li key={`${hit.page}-${hit.category}`}>
                            {m.imports_pdf_scan_hit({
                                // One-based, because the operator is looking at
                                // a page numbered by their PDF reader and not
                                // at an array index.
                                page: String(hit.page + 1),
                                kind: KIND_LABEL[hit.category](),
                            })}
                        </li>
                    ))}
                </ul>
                <p>{m.imports_pdf_scan_withheld()}</p>
            </div>
        </Banner>
    );
}
