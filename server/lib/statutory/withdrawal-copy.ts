/**
 * The server's words for a withdrawn revision — one sentence per reason, in one
 * place.
 *
 * ── WHY THE TWO REASONS CANNOT SHARE A SENTENCE ─────────────────────────────
 * "This revision was withdrawn" is the sentence that fails. It is true of both
 * causes and actionable for neither, and the actions are opposites:
 *
 *   `field_map_incorrect` — this software printed answers into the wrong boxes.
 *       A corrected map ships as a software update; the documents already
 *       issued from the revision may have to be issued again once it does. The
 *       reader WAITS, and re-issues afterwards.
 *   `authority_withdrew` — the authority retired the document. No update will
 *       bring it back, so waiting is the one thing that does not help. The
 *       reader MOVES to whatever revision is now in force.
 *
 * Tell someone only that a revision was withdrawn and half of them will wait
 * for a fix that is never coming, while the other half will go looking for a
 * replacement form that does not exist yet.
 *
 * ── WHY THIS IS NOT PARAGLIDE ───────────────────────────────────────────────
 * These are the API's refusal messages: they are thrown from a service and
 * returned as an error body, on a path with no request locale in scope and no
 * message catalogue loaded. The workspace-facing translations of the same two
 * reasons live where the reader is — `RevisionBanner` and
 * `StatutoryUpdateConfirm`, both through `app/paraglide/messages` — and this
 * file is deliberately not a second copy of them: what it explains is why a
 * request was refused, addressed to whoever reads an error.
 */
import type { WithdrawalReason } from './form-registry';

export interface WithdrawalRefusalInput {
    formId: string;
    /** The withdrawn revision's own label. */
    version: string;
    reason: WithdrawalReason;
    /** When it was withdrawn, epoch ms. */
    at: number;
    /**
     * The revision that governs this inspection now, or null when this
     * deployment publishes none for that date. Null is an answer, not a gap:
     * an authority may withdraw a revision before publishing its successor,
     * and naming a replacement that does not exist sends somebody looking for
     * a form nobody has.
     */
    replacementVersion: string | null;
    /** The inspection's own calendar day, `YYYY-MM-DD`. */
    inspectionDate: string;
}

/**
 * The cutover day spelled in UTC, matching how the revision was selected
 * (`inspection-date.ts`). A locale-formatted date here would name a different
 * day than the one the withdrawal actually took effect on.
 */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Why this form cannot be produced, and what the reader does about it. */
export function withdrawalRefusal(input: WithdrawalRefusalInput): string {
    const head = `Revision ${input.version} of "${input.formId}" was withdrawn on `
        + `${day(input.at)} and cannot be produced. `;

    const move = input.replacementVersion === null
        ? 'This deployment publishes no other revision covering '
            + `${input.inspectionDate}, so the form for that date has to be obtained from the `
            + 'authority directly.'
        : `Revision ${input.replacementVersion} governs ${input.inspectionDate}: once the `
            + 'workspace has updated its copy of the template, start this inspection again on '
            + 'it. There is no migration for an inspection already under way.';

    if (input.reason === 'field_map_incorrect') {
        return `${head}A defect was found in this software's field map for it — the map that `
            + 'decides which box on the authority\'s form each answer is printed in — so a '
            + 'document produced from this revision may not say what was inspected. A corrected '
            + `map is published as a software update; every document already produced from `
            + `revision ${input.version} should be produced again once it lands. ${move}`;
    }

    return `${head}The authority withdrew it, so this is not a defect a software update will `
        + 'correct and there is nothing to wait for: the document itself is no longer the one '
        + `to file. Documents already produced from revision ${input.version} were correct for `
        + `their inspection dates and are not reissued for this reason. ${move}`;
}
