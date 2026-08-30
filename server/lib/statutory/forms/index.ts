/**
 * The statutory forms this software ships with — today four: Texas TREC REI
 * 7-6, and the three Florida forms published on 2026-08-30.
 *
 * ── Why this file declares its own emptiness ────────────────────────────────
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
import { version as trecRei76Version, fieldMap as trecRei76Map } from './tx-trec-rei-7-6';
import { version as flCitizens4pointVersion, fieldMap as flCitizens4pointMap } from './fl-citizens-4point';
import { version as flCitizensRoofVersion, fieldMap as flCitizensRoofMap } from './fl-citizens-roof';
import { version as flOirB11802Version, fieldMap as flOirB11802Map } from './fl-oir-b1-1802';
import type { StatutoryFormVersion } from '../form-registry';

/**
 * ⚠️ THE FORM IDS BELOW ARE NOT SPELT CONSISTENTLY, AND ONE OF THEM IS WRONG.
 *
 * `form-registry.ts` states the rule where `formId` is declared: it NAMES A
 * FORM, NEVER A REVISION, and its own example id is `tx_trec_rei`. The three
 * Florida ids follow it — `fl_citizens_4point`, `fl_citizens_roof`,
 * `fl_oir_b1_1802`, none carrying a revision. `tx_trec_rei_7_6` does not, and
 * it is the one that is wrong.
 *
 * It is not a tidiness question. `versionForInspection` groups by `formId` and
 * then picks by date, so publishing TREC's next revision under
 * `tx_trec_rei_7_7` would produce a SECOND form id: the two revisions would
 * never be compared with each other, and selecting a revision by inspection
 * date — the mechanism this whole subsystem exists for — would silently stop
 * working for that form.
 *
 * It is not corrected here because the id reaches four other places, and each
 * one has to move with it: the seed template's `statutoryForm.formId`, the
 * object-storage key `_platform/statutory-forms/tx_trec_rei_7_6/…` under which
 * bytes have already been uploaded, the marketplace catalogue fixture, and the
 * tests that name it. Renaming the id without migrating the stored bytes leaves
 * a published revision whose PDF cannot be found — the deployment reports
 * "upload the official file first" for a file it already has. So it is a change
 * of its own, with a migration, rather than a rename dropped into this one.
 *
 * ⚠️ SO DO NOT COPY THE TREC ID'S SHAPE FOR A FIFTH FORM. The three Florida
 * ones are the pattern to follow.
 */

/**
 * Why the two lists below are empty, or `null` once they are not.
 *
 * ⚠️ Keep this and the lists in step: a reason left behind after a form is
 * published is a stale explanation of a state that no longer holds, which is
 * why the gate treats it as a failure rather than as tidy-up.
 */
// ⚠️ NULL BECAUSE THE CATALOGUE IS NO LONGER EMPTY. This reason exists to make
// "no forms" checkable rather than inferred; a reason left behind after a form
// is published is a stale explanation of a state that no longer holds, which is
// why the fidelity gate treats it as a failure rather than as tidy-up.
export const EMPTY_CATALOGUE_REASON: string | null = null;

/** Every revision published with this software. Selected by inspection date, never by "latest". */
export const PUBLISHED_FORM_VERSIONS: readonly StatutoryFormVersion[] = [
    trecRei76Version,
    flCitizens4pointVersion,
    flCitizensRoofVersion,
    flOirB11802Version,
];

/** The hand-authored map for each of those revisions, one per (formId, version). */
export const FIELD_MAPS: readonly FieldMap[] = [
    trecRei76Map,
    flCitizens4pointMap,
    flCitizensRoofMap,
    flOirB11802Map,
];

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
