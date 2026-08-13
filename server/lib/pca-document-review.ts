// server/lib/pca-document-review.ts

/**
 * ASTM E2018 §8.6 Document Review — turning checklist rows into the narrative
 * the report prints.
 *
 * The rule this encodes is the reason `document_review_items` exists at all:
 * a document that was requested and never arrived is a LIMITATION on the
 * assessment, and a limitation has to be stated. So every checklist row
 * produces a line, including the ones with nothing ticked; the checklist is a
 * disclosure instrument, not a to-do list, and filtering it down to the
 * finished rows would quietly narrow what the report claims to have reviewed.
 *
 * Extracted from the Word-export consumer so the rule is reachable on its own.
 * It was a module-private function inside a queue handler, which is why the one
 * mapping in the file that a reader of the report can actually see had no test.
 */

export type DocumentReviewRow = {
    label: string;
    requested: boolean;
    received: boolean;
    reviewed: boolean;
    na: boolean;
    notes: string | null;
};

export type DocumentReviewNarrativeItem = { label: string; narrative: string };

/**
 * The status phrase for one checklist row.
 *
 * The four flags are independent claims, not a single progress value, and they
 * are printed cumulatively for that reason: "Requested, Received" says the
 * document arrived and has NOT yet been read, which is a different disclosure
 * from "Requested, Received, Reviewed". A row with nothing ticked falls back to
 * "Not requested" rather than to an empty string — an empty cell would read as
 * a formatting slip instead of as the statement it is.
 */
export function documentReviewStatusPhrase(row: DocumentReviewRow): string {
    return [
        row.na ? 'N/A' : null,
        row.requested ? 'Requested' : null,
        row.received ? 'Received' : null,
        row.reviewed ? 'Reviewed' : null,
    ].filter((s): s is string => s !== null).join(', ') || 'Not requested';
}

/**
 * §4 Document Review & Interviews narrative items — every checklist row, in the
 * order given, plus the PSQ status as a final line.
 *
 * The PSQ line is appended whenever a `psq_responses` row exists at all,
 * whatever its status: a `declined` questionnaire is precisely the case §8.5
 * requires to be disclosed, so dropping the line for it would hide the one
 * state worth printing.
 */
export function documentReviewNarrativeItems(
    documentReview: DocumentReviewRow[],
    psq: { status: string } | null,
): DocumentReviewNarrativeItem[] {
    const items = documentReview.map((d) => {
        const phrase = documentReviewStatusPhrase(d);
        return { label: d.label, narrative: d.notes ? `${phrase} — ${d.notes}` : phrase };
    });
    if (psq) items.push({ label: 'Pre-Survey Questionnaire (PSQ)', narrative: `Status: ${psq.status}` });
    return items;
}
