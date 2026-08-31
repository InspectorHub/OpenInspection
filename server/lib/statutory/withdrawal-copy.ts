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

/**
 * The OTHER refusal this route raises, kept beside the withdrawal one.
 *
 * Same status code, different sentence, and the difference matters: a withdrawal
 * says this software's map (or the authority's document) is at fault; this one
 * says the TEMPLATE was written against a revision the inspection's date does
 * not select. Printing anyway would put the governing revision's bytes under the
 * superseded revision's bindings, and where two revisions' field names overlap
 * the result is a plausible, WRONG official document.
 *
 * It moved out of the route when that file reached its size ceiling. The two
 * refusals belong together anyway: they are the server's words for "this
 * revision is not the one to produce", and a reader comparing them can see that
 * only one of them is about a defect.
 */
export function supersededRefusal(input: {
    formId: string;
    inspectionDate: string;
    /** The revision the inspection's own date selects. */
    applicableVersion: string;
    /** The revision the template says its bindings were written against. */
    templateVersion: string;
}): string {
    return `This inspection is dated ${input.inspectionDate}, which revision `
        + `${input.applicableVersion} of ${input.formId} governs. This template produces revision `
        + `${input.templateVersion}, so its bindings were written against a different document `
        + 'and cannot be printed onto this one. There is no migration for an inspection already '
        + `under way: once the workspace has updated its copy of the template, reopen this `
        + `inspection on the ${input.applicableVersion} template.`;
}
