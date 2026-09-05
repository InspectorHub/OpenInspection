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
 * EVERY FORM ID BELOW NAMES A FORM. NONE OF THEM NAMES A REVISION.
 *
 * `form-registry.ts` states the rule where `formId` is declared: an id names a
 * FORM, NEVER a revision of it, because an id carrying a revision number cannot
 * express two revisions of one form being usable at once — which is exactly
 * what a voluntary-use window is, and TREC REI 7-6 has one (voluntary from
 * 2021-09-01, required from 2022-02-01).
 *
 * It is not a tidiness question. `versionForInspection` groups by `formId` and
 * then picks by date, so a TREC revision published under `tx_trec_rei_7_7`
 * would be a SECOND form id: the two revisions would never be compared with
 * each other, `revisionStatus` could never answer `superseded_elsewhere` for
 * either, and selecting a revision by inspection date — the mechanism this
 * whole subsystem exists for — would silently stop working for that form. The
 * selector would keep returning a perfectly valid answer, and nothing would go
 * red.
 *
 * ⚠️ SO DO NOT PUT A REVISION LABEL IN A FIFTH FORM'S ID.
 * `tests/unit/statutory-forms/catalogue.spec.ts` asserts this over every
 * published row, judged against each row's OWN revision label rather than
 * against a pattern written by hand, which would only ever agree with itself.
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
