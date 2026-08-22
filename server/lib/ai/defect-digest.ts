/**
 * Turning a stored results blob into the defect list a summary prompt is given
 * — and the one sentence used when there is nothing to summarise.
 *
 * WHY THIS IS ITS OWN MODULE. It is the boundary that decides WHICH INSPECTION
 * FIELDS reach a model. Everything this function keeps is sent to a third
 * party; everything it drops is not, and that list is a compliance fact
 * recorded in the data-flow document rather than an implementation detail of a
 * service method. Widening it — adding the item label, the address, the
 * client's name — is a change to what leaves the process, and it should read
 * like one in a diff.
 *
 * It also keeps `services/ai.service.ts` under the large-file ratchet.
 */

/**
 * The summary the system states when there is nothing for a model to
 * summarise.
 *
 * A constant because it is returned from two arms that must say the same
 * thing, and because it is the one summary in this pipeline that no model
 * wrote — the reason both arms return a null `aiCallId`.
 */
export const NO_DEFECTS_SUMMARY = 'No significant defects observed during this inspection.';

/** One stored result. Only these two fields are read, and that narrowness is
 *  the point rather than an omission. */
interface StoredResult {
    status: string;
    notes?: string;
}

/**
 * The defect notes, one per line, or an empty string when there are none.
 *
 * The NOTES ONLY — the inspector's own words about the finding. Not the item
 * key, which would name the component; not the rest of the row. An entry with
 * no note still contributes a line, because a defect the inspector did not
 * describe is still a defect and dropping it would silently shorten the list
 * the summary is drawn from.
 */
export function defectDigest(data: Record<string, StoredResult>): string {
    return Object.entries(data)
        .filter(([, val]) => val.status === 'Defect')
        .map(([, val]) => `- ${val.notes || 'No description provided'}`)
        .join('\n');
}
