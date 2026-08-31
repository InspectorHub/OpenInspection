/**
 * Statutory form versions, and choosing one by the INSPECTION date.
 *
 * A statutory form is not a template. It is an authority's own published PDF,
 * and the question this file answers is the only one that can be answered in
 * code without reading the form: WHICH REVISION applies to an inspection.
 *
 * ── Why the inspection date and not "the current one" ───────────────────────
 * A report is routinely produced days or weeks after the inspection it
 * describes, and an authority may keep a superseded revision valid long after
 * publishing its replacement. Selecting by "latest" therefore renders a
 * document the inspection was not performed against — silently, because both
 * documents look official. Selection is by inspection date, always.
 *
 * ── Two functions, because there are two questions ──────────────────────────
 * A revision may be publishable months before it is mandatory. Inside that
 * window BOTH revisions are usable and the choice belongs to the inspector, so:
 *
 *   `selectableVersions()` — every revision usable for that date, oldest first.
 *   `versionForInspection()` — the DEFAULT: the revision that is mandatory on
 *                             that date.
 *
 * Collapsing them into one function is how the choice disappears. The default
 * never drifts to a newer, not-yet-mandatory revision on its own: adopting one
 * early is a decision, and a registry that made it silently would be
 * substituting one statutory document for another.
 *
 * ── Only a PUBLISHED revision is ever selected ──────────────────────────────
 * Both functions admit a row only if it carries the marks of a publication
 * decision — see `isPublishedVersion`. A scheduled watcher detects that an
 * authority changed its form (`revision-watch.ts`); what it learns is a page, a
 * digest and a date it looked, and none of that is an effective date or a
 * publisher. So a row assembled from a detection is refused here rather than
 * quietly selected, and detection can never become adoption by someone copying
 * fields across.
 *
 * ── This file holds no PDF bytes and no field map ───────────────────────────
 * A version identifies bytes by `sourceHash`; where those bytes live is object
 * storage, recorded on the `statutory_form_versions` row. The map from our
 * fields onto that PDF is `field-map.ts`, and it is bound to a single
 * `sourceHash` because it may never be inherited across revisions.
 */

/**
 * WHY a revision stopped being produceable. Two causes, and they are not two
 * spellings of one thing — they demand opposite next steps from a workspace:
 *
 *   `field_map_incorrect` — OUR fault. The map that decides which box each
 *       answer prints in was found wrong, so documents already produced from
 *       this revision may say something other than what was inspected. A
 *       corrected map is coming, in a software update, and the documents
 *       already issued may have to be issued again once it lands. The workspace
 *       WAITS for us.
 *   `authority_withdrew` — the publisher's decision. The document itself is no
 *       longer the one to file. Nothing we ship will bring it back, so there is
 *       nothing to wait for: the workspace moves to whichever revision is now
 *       in force. The workspace ACTS, now.
 *
 * One word for both ("withdrawn") is a word that tells nobody which of those to
 * do, which is why every surface that reports a withdrawal reports the reason
 * with it.
 */
export type WithdrawalReason = 'field_map_incorrect' | 'authority_withdrew';

/**
 * A withdrawal: when, and why.
 *
 * ⚠️ ONE OBJECT RATHER THAN TWO PARALLEL NULLABLE FIELDS, and that is the whole
 * point of the shape. `withdrawnAt: number | null` beside `reason: Reason |
 * null` can be written in two states that must not exist — a withdrawal with no
 * reason, and a reason on a revision that is still live — and neither is a
 * compile error, so both become a runtime check somebody has to remember to
 * write and every reader has to remember to trust. Nested, the pairing is not
 * expressible wrongly: the date and the reason arrive together or neither does,
 * and no validation is needed because there is no invalid value to validate.
 */
export interface StatutoryWithdrawal {
    /** When new production stopped, epoch ms. */
    at: number;
    reason: WithdrawalReason;
}

/**
 * One published revision of one statutory form.
 *
 * `formId` names the FORM, never a revision of it — a form id carrying a
 * revision number cannot express two revisions of the same form being usable at
 * once, which is exactly what a voluntary-use window is.
 */
export interface StatutoryFormVersion {
    /** Stable id of the form itself, e.g. `tx_trec_rei`. Never revision-specific. */
    formId: string;
    /**
     * What the authority calls this form, as a person would recognise it:
     * `Texas Real Estate Commission Property Inspection Report`.
     *
     * It exists because `formId` is a database key and was being READ ALOUD to
     * inspectors — the notice said "a software implementation of
     * `fl_oir_b1_1802`", which names nothing an inspector has ever seen. The
     * form prints its own title and its own revision label; those two are what
     * a reader can check against the authority's site, and `formId` is neither.
     *
     * Not derived from `formId`, and it must not be: an id is lowercased,
     * underscored and abbreviated, and no un-abbreviation of one produces the
     * authority's wording. It is transcribed from the published form, like the
     * revision label beside it.
     */
    formTitle: string;
    /** The authority's own revision label, verbatim: `REI 7-6`, `Rev. 04/26`. */
    version: string;
    /** First date this revision may be used, epoch ms. */
    effectiveFrom: number;
    /**
     * First date this revision is REQUIRED, epoch ms, or null for a revision
     * that was published but never mandated. A null here keeps the revision
     * selectable and keeps it out of the default — it can only be reached by an
     * explicit choice.
     */
    mandatoryFrom: number | null;
    /**
     * First date this revision may no longer be used, epoch ms — exclusive.
     * `null` means it is still usable. It is NOT "the latest revision": several
     * revisions can carry null while an authority runs an overlap.
     */
    effectiveUntil: number | null;
    /** Where the authority publishes it. Provenance for a human, never fetched at render time. */
    sourceUrl: string;
    /** sha256 (lowercase hex) of the exact bytes published for this revision. */
    sourceHash: string;
    /** The operator who published it into this deployment. */
    publishedBy: string;
    /** When they published it, epoch ms. */
    publishedAt: number;
    /**
     * The withdrawal that stopped new production, or null while the revision is
     * live. Its `reason` is not decoration — see `WithdrawalReason`: the two
     * causes hand a workspace opposite next steps, and every surface that
     * reports a withdrawal reads the reason from here rather than inventing a
     * single sentence for both.
     *
     * A withdrawn revision STAYS in the catalogue. `lint:statutory-additive`
     * forbids a revision DISAPPEARING, not a revision being withdrawn: removing
     * it would break re-issuing every report already produced from it, and those
     * reports are official documents already in other people's hands.
     *
     * Not optional, deliberately. A revision that never says whether it is
     * withdrawn is one the compiler lets through with `undefined`, and
     * `undefined` reads as "not withdrawn" in every comparison anybody writes
     * afterwards — so the one state that must be stated explicitly would be the
     * one you get by saying nothing.
     */
    withdrawn: StatutoryWithdrawal | null;
}

/** A sha256 as this subsystem spells it everywhere: lowercase hex, no separators. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Did a PERSON publish this revision, or is it something we merely observed?
 *
 * The distinction is not decorative. A scheduled watcher polls the authority's
 * page and can establish four things: which form it was looking for, the page,
 * the digest of the bytes served, and when it looked (`revision-watch.ts`). It
 * cannot establish the date a revision takes effect, the date it becomes
 * mandatory, or whose decision it was that this deployment offers it — those
 * are not observations, they are a publication.
 *
 * So the marks below are exactly the ones detection cannot forge by being
 * copied: a row assembled out of a sighting has a blank publisher and a zero
 * publication date, and is refused here. Without this the detect/adopt line
 * would be a convention — true only while nobody wrote the twelve lines that
 * fill a version row in from a sighting, which is a thing somebody writes on
 * the day a state changes its form and everybody is in a hurry.
 *
 * Deliberately NOT exported: there is no caller outside this module, and a
 * published predicate with no consumer is one somebody calls INSTEAD of going
 * through `selectableVersions`, which is the one door that applies it.
 *
 * ⚠️ It cannot check that the DATES are right — an operator who publishes a
 * revision with the wrong effective date gets a version that is selected on the
 * wrong days, and nothing here can tell. This refuses an unpublished revision,
 * not a mis-published one.
 */
function isPublishedVersion(version: StatutoryFormVersion): boolean {
    if (version.publishedBy.trim() === '') return false;
    if (!Number.isFinite(version.publishedAt) || version.publishedAt <= 0) return false;
    if (!Number.isFinite(version.effectiveFrom)) return false;
    // The join between the row, the stored bytes and the field map authored
    // against them. A row whose hash is not one is a row nothing can be
    // rendered from, so it is not offered as though it could be.
    return SHA256_HEX.test(version.sourceHash);
}

/** Is this revision usable for an inspection performed at `inspectedAt`? */
function isSelectable(version: StatutoryFormVersion, inspectedAt: number): boolean {
    if (inspectedAt < version.effectiveFrom) return false;
    // Exclusive upper bound: a revision that ends on the day its replacement
    // begins must not be selectable on that day, or a clean cutover reads as an
    // overlap and the default silently keeps the withdrawn revision.
    return version.effectiveUntil === null || inspectedAt < version.effectiveUntil;
}

/**
 * Every revision of `formId` usable for an inspection on `inspectedAt`, oldest
 * first.
 *
 * Empty means we carry no revision covering that date — including the case
 * where the inspection predates every revision we hold. It never means "here is
 * the nearest one": the nearest revision to a date it does not cover is a
 * different document.
 */
export function selectableVersions(
    formId: string,
    inspectedAt: number,
    versions: readonly StatutoryFormVersion[],
): readonly StatutoryFormVersion[] {
    return versions
        // `isPublishedVersion` FIRST, and in this function rather than in the
        // caller: this is the single door every selection goes through, and a
        // check the caller has to remember is a check that is missing from the
        // caller written next year.
        // `withdrawnAt` sits HERE and not on the caller for the same reason as
        // `isPublishedVersion` above: this is the single door, and a withdrawal
        // the caller has to remember to honour is a withdrawal the caller
        // written next year does not honour. Filtering it in the default alone
        // would leave a revision known to be wrong one click away in the picker.
        .filter((v) => isPublishedVersion(v) && v.withdrawn === null
            && v.formId === formId && isSelectable(v, inspectedAt))
        // Sorted here rather than trusted from the caller: the list arrives from
        // a table with no guaranteed order, and both consumers below read
        // position.
        .slice()
        .sort((a, b) => a.effectiveFrom - b.effectiveFrom);
}

/**
 * The revision that applies by default to an inspection on `inspectedAt`, or
 * `null` if we carry none covering that date.
 *
 * The default is the revision that is MANDATORY on that date — the newest such,
 * so a mandate that supersedes an earlier one wins. When no selectable revision
 * is mandatory (all of them are voluntary on that date) the oldest selectable
 * one is returned: the incumbent, never the newest, for the reason in the file
 * header.
 */
export function versionForInspection(
    formId: string,
    inspectedAt: number,
    versions: readonly StatutoryFormVersion[],
): StatutoryFormVersion | null {
    const usable = selectableVersions(formId, inspectedAt, versions);
    if (usable.length === 0) return null;

    const mandatory = usable.filter(
        (v) => v.mandatoryFrom !== null && v.mandatoryFrom <= inspectedAt,
    );
    if (mandatory.length === 0) return usable[0];

    return mandatory.reduce((best, v) =>
        // Non-null on both sides by the filter above; compared explicitly so the
        // narrowing is visible rather than asserted.
        (v.mandatoryFrom ?? 0) > (best.mandatoryFrom ?? 0) ? v : best);
}

/**
 * The revisions of `formId` that WOULD cover `inspectedAt` but for having been
 * withdrawn, newest withdrawal first.
 *
 * This exists because "no revision covers that date" and "the revision that
 * covers that date was withdrawn" are the same `null` out of
 * `versionForInspection`, and they are not the same sentence to read. The first
 * means this deployment publishes nothing for that day; the second means it
 * published something and took it out of service, and the reason it did decides
 * whether the reader waits for us or moves on their own. A refusal that cannot
 * tell them apart says "no published revision covers 2026-04-01" about a
 * revision that plainly does.
 *
 * The date window and the publication marks are applied by exactly the same
 * predicates `selectableVersions` uses — the point is to change one term of the
 * filter, not to re-derive selection somewhere a later edit can drift.
 */
export function withdrawnVersionsFor(
    formId: string,
    inspectedAt: number,
    versions: readonly StatutoryFormVersion[],
): readonly StatutoryFormVersion[] {
    return versions
        .filter((v) => isPublishedVersion(v) && v.withdrawn !== null
            && v.formId === formId && isSelectable(v, inspectedAt))
        .slice()
        // Newest withdrawal first: when an authority withdrew a revision and a
        // later one was withdrawn again for a different reason, the most recent
        // decision is the one a reader is being asked to act on.
        .sort((a, b) => (b.withdrawn?.at ?? 0) - (a.withdrawn?.at ?? 0));
}
