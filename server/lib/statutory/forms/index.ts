/**
 * The statutory forms this software ships with — and, today, the declaration
 * that it ships with none.
 *
 * ── Why this file exists while it is empty ──────────────────────────────────
 * An empty list and a list that failed to load look identical to every reader
 * downstream, and "no statutory forms" is a sentence somebody has to be able to
 * check. So emptiness is DECLARED here, in `EMPTY_CATALOGUE_REASON`, and the
 * fidelity gate (`scripts/check-statutory-fidelity.mjs`) refuses an empty
 * catalogue that carries no declaration. It also refuses a declaration that
 * outlives the emptiness it explains.
 *
 * ── What publishing one actually costs ──────────────────────────────────────
 * Two things, and neither is a download:
 *
 *   1. The authority's own published PDF. It is that agency's document and it
 *      is not carried in this repository; an operator supplies it, and its
 *      sha256 is recorded on the `statutory_form_versions` row.
 *   2. A field map, authored against that exact revision's bytes by a person
 *      who read the form. It cannot be generated, and it cannot be inherited
 *      from the previous revision — `field-map.ts` explains why in detail, and
 *      the short version is that these forms' field names are typed by hand and
 *      a corrected typo silently moves content into a different box.
 *
 * A revision therefore costs redoing the layout, not fetching a file.
 */
import { validateFieldMap, type FieldMap } from '../field-map';
import type { StatutoryFormVersion } from '../form-registry';

/**
 * Why the two lists below are empty, or `null` once they are not.
 *
 * ⚠️ Keep this and the lists in step: a reason left behind after a form is
 * published is a stale explanation of a state that no longer holds, which is
 * why the gate treats it as a failure rather than as tidy-up.
 */
export const EMPTY_CATALOGUE_REASON: string | null =
    'No statutory form is published with this software. Publishing one needs the authority\'s own '
    + 'PDF, which is that agency\'s document rather than something distributed here, and a field '
    + 'map checked against that exact revision by a person who read the form. Until an operator '
    + 'holds both for a given revision there is nothing to list — and it is empty by declaration '
    + 'so that "no forms" can never be confused with "the forms did not load".';

/** Every revision published with this software. Selected by inspection date, never by "latest". */
export const PUBLISHED_FORM_VERSIONS: readonly StatutoryFormVersion[] = [];

/** The hand-authored map for each of those revisions, one per (formId, version). */
export const FIELD_MAPS: readonly FieldMap[] = [];

/**
 * The map for one revision, or `null` if this software carries none.
 *
 * The map is validated against its version on every lookup rather than at module
 * load: a mismatch is a fault in one form, and it should refuse that form rather
 * than take the deployment down with it.
 */
export function fieldMapFor(formId: string, version: string): FieldMap | null {
    const row = PUBLISHED_FORM_VERSIONS.find((v) => v.formId === formId && v.version === version);
    const map = FIELD_MAPS.find((m) => m.formId === formId && m.version === version);
    if (row === undefined || map === undefined) return null;
    validateFieldMap(map, row);
    return map;
}
