/**
 * Citizens Property Insurance roof inspection form (RCF-1 03 25) -- the
 * published revision and the map checked against it.
 *
 * -- GENERATED FROM THE SIGNED CANDIDATE, NOT TYPED BY HAND ------------------
 * The 60 mappings below were emitted from the artifact a person signed
 * (`checkedBy: Nathan`, 2026-08-30) rather than copied. Hand-copying would
 * introduce differences the signature does not cover, and this file exists to
 * carry that signature into the software unchanged.
 *
 * -- WHICH PDF THIS IS ------------------------------------------------------
 * The two-page form Citizens publishes as `Roof Inspection Form.pdf`, footer
 * `Sample Form RCF-1 03 25`. Like the four-point form it carries no form fields
 * at all, so every mapping draws at a measured coordinate.
 *
 * ⚠️ PAGE 1 IS NOT A BACK COVER. It holds eight real fill points -- the whole
 * signature block plus Additional Comments -- and the habit of skipping a
 * statutory form's last page misses every one of them.
 *
 * -- WHY THE SAME FIELD NAMES AS THE FOUR-POINT FORM, WITH DIFFERENT NUMBERS -
 * The two forms share a publisher, a bulletin and twelve roof field names, and
 * eight of the twelve roof blanks sit at DIFFERENT coordinates here. That is
 * the live example of the rule in `field-map.ts`: a map is authored per
 * revision and per document, and is never inherited from a form that looks like
 * this one.
 *
 * -- THE HASH IS WRITTEN TWICE, ON PURPOSE ----------------------------------
 * Once on the revision and once on the map. A shared constant would make them
 * impossible to diverge -- and would also make that impossible to CHECK:
 * `check-statutory-fidelity.mjs` reads sha256 literals, and a constant it
 * cannot resolve reads to it as a file declaring none.
 *
 * -- THE DATES ARE THE PUBLISHER'S OWN --------------------------------------
 * Citizens' 2025-03-20 bulletin, the same one that published the four-point
 * revision: "Agents and Florida-licensed inspectors should begin using the
 * updated forms immediately." ⚠️ `03 25` in the revision label is MONTH-YEAR --
 * March 2025 -- not the 25th of March; a day cannot be read off a revision
 * string and this one came from the bulletin.
 *
 * `mandatoryFrom` is null on positive evidence, not for want of looking: the
 * bulletin says an older version "will not be rejected", so this revision was
 * never mandated. `versionForInspection` is built for that case -- when no
 * selectable revision is mandatory it returns the incumbent, so a null here
 * does not need covering up with an invented date.
 *
 * ⚠️ NOTHING DECLARES THIS FORM YET, exactly as for the other three.
 */
import type { StatutoryFormVersion } from '../form-registry';
import type { FieldMap } from '../field-map';

export const version: StatutoryFormVersion = {
    formId: 'fl_citizens_roof',
    version: 'RCF-1 03 25',
    // Citizens' 2025-03-20 bulletin: begin using the updated forms immediately.
    effectiveFrom: Date.UTC(2025, 2, 20),
    // Never mandated, on the bulletin's own words. See the file header.
    mandatoryFrom: null,
    // Still current: Citizens has published no successor as of the publish date.
    effectiveUntil: null,
    withdrawn: null,
    sourceUrl: 'https://www.citizensfla.com/documents/20702/48575/Roof+Inspection+Form.pdf/b684cd08-e1ee-8092-f475-772a210fa127?t=1743432183669',
    sourceHash: '96e1ad368c80915732bc8c6147839e1eff0828424c142566fde8a4ca22427025',
    publishedBy: 'InspectorHub',
    publishedAt: Date.UTC(2026, 7, 30),
};

export const fieldMap: FieldMap = {
    formId: 'fl_citizens_roof',
    version: 'RCF-1 03 25',
    // Written a SECOND time on purpose. See the file header.
    sourceHash: '96e1ad368c80915732bc8c6147839e1eff0828424c142566fde8a4ca22427025',
    checkedBy: 'Nathan',
    checkedAt: Date.UTC(2026, 7, 30),
    requiredFields: [
        'inspector_signature',
        'inspector_signature_date',
    ],
    mappings: [
        { kind: 'overlay', ourField: 'insured_applicant_name', page: 0, x: 119.3, y: 718.22, size: 9.0, maxWidth: 223.92, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'application_policy_number', page: 0, x: 416.6, y: 718.52, size: 9.0, maxWidth: 145.02, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'address_inspected', page: 0, x: 104.9, y: 693.2, size: 9.0, maxWidth: 456.72, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'date_inspected', page: 0, x: 104.42, y: 669.74, size: 9.0, maxWidth: 155.16, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].covering_material', page: 0, x: 111.26, y: 456.56, size: 9.0, maxWidth: 41.64, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].roof_age_years', page: 0, x: 108.2, y: 441.38, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].remaining_useful_life_years', page: 0, x: 147.8, y: 426.08, size: 9.0, maxWidth: 41.46, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].date_of_last_roofing_permit', page: 0, x: 140.24, y: 410.84, size: 9.0, maxWidth: 41.52, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].date_of_last_update', page: 0, x: 115.76, y: 395.6, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[0].update_extent', whenValue: 'full_replacement', page: 0, x: 52.42, y: 364.46, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].update_extent', whenValue: 'partial_replacement', page: 0, x: 52.42, y: 348.98, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[0].percent_of_replacement', page: 0, x: 127.64, y: 334.58, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[0].overall_condition', whenValue: 'satisfactory', page: 0, x: 52.42, y: 303.44, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].overall_condition', whenValue: 'unsatisfactory', page: 0, x: 52.42, y: 289.04, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cracking', page: 0, x: 52.42, y: 243.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cupping_curling', page: 0, x: 52.42, y: 231.08, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'excessive_granule_loss', page: 0, x: 52.42, y: 218.84, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'exposed_asphalt', page: 0, x: 52.42, y: 206.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'exposed_felt', page: 0, x: 52.42, y: 194.36, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'missing_loose_cracked_tabs_or_tiles', page: 0, x: 52.42, y: 182.18, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'soft_spots_in_decking', page: 0, x: 52.42, y: 170.18, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'visible_hail_damage', page: 0, x: 52.54, y: 157.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].visible_signs_of_leaks', whenValue: 'yes', page: 0, x: 153.58, y: 142.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].visible_signs_of_leaks', whenValue: 'no', page: 0, x: 185.56, y: 142.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_attic_underside_of_decking', whenValue: 'yes', page: 0, x: 142.96, y: 130.58, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_attic_underside_of_decking', whenValue: 'no', page: 0, x: 174.82, y: 130.58, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_interior_ceilings', whenValue: 'yes', page: 0, x: 105.1, y: 118.34, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_interior_ceilings', whenValue: 'no', page: 0, x: 137.02, y: 118.34, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[1].covering_material', page: 0, x: 382.46, y: 456.56, size: 9.0, maxWidth: 41.64, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].roof_age_years', page: 0, x: 379.4, y: 441.38, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].remaining_useful_life_years', page: 0, x: 419.0, y: 426.08, size: 9.0, maxWidth: 41.46, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].date_of_last_roofing_permit', page: 0, x: 411.44, y: 410.84, size: 9.0, maxWidth: 37.02, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].date_of_last_update', page: 0, x: 386.96, y: 395.6, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[1].update_extent', whenValue: 'full_replacement', page: 0, x: 319.42, y: 364.46, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].update_extent', whenValue: 'partial_replacement', page: 0, x: 319.42, y: 348.98, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[1].percent_of_replacement', page: 0, x: 394.64, y: 334.58, size: 9.0, maxWidth: 41.58, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[1].overall_condition', whenValue: 'satisfactory', page: 0, x: 319.42, y: 303.44, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].overall_condition', whenValue: 'unsatisfactory', page: 0, x: 319.42, y: 289.04, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'cracking', page: 0, x: 323.62, y: 243.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'cupping_curling', page: 0, x: 323.62, y: 231.08, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'excessive_granule_loss', page: 0, x: 323.62, y: 218.84, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'exposed_asphalt', page: 0, x: 323.62, y: 206.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'exposed_felt', page: 0, x: 323.62, y: 194.36, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'missing_loose_cracked_tabs_or_tiles', page: 0, x: 323.62, y: 182.18, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'soft_spots_in_decking', page: 0, x: 323.62, y: 170.18, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'visible_hail_damage', page: 0, x: 323.74, y: 157.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].visible_signs_of_leaks', whenValue: 'yes', page: 0, x: 424.78, y: 142.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].visible_signs_of_leaks', whenValue: 'no', page: 0, x: 456.76, y: 142.94, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_attic_underside_of_decking', whenValue: 'yes', page: 0, x: 414.16, y: 130.58, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_attic_underside_of_decking', whenValue: 'no', page: 0, x: 446.02, y: 130.58, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_interior_ceilings', whenValue: 'yes', page: 0, x: 376.3, y: 118.34, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_interior_ceilings', whenValue: 'no', page: 0, x: 408.22, y: 118.34, size: 7.0 },
        { kind: 'overlay', ourField: 'additional_comments', page: 1, x: 45.0, y: 697.0, size: 9.0, maxWidth: 525.0, maxHeight: 103.96 },
        { kind: 'overlay', ourField: 'inspector_signature', page: 1, x: 43.16, y: 529.22, size: 9.0, maxWidth: 135.96, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_title', page: 1, x: 189.98, y: 530.06, size: 9.0, maxWidth: 112.92, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_license_number', page: 1, x: 313.76, y: 530.06, size: 9.0, maxWidth: 131.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_signature_date', page: 1, x: 456.44, y: 529.22, size: 9.0, maxWidth: 114.84, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_company_name', page: 1, x: 43.16, y: 490.04, size: 9.0, maxWidth: 135.96, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_license_type', page: 1, x: 189.98, y: 490.88, size: 9.0, maxWidth: 112.92, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_work_phone', page: 1, x: 313.76, y: 490.88, size: 9.0, maxWidth: 131.4, maxHeight: 11.0 },
    ],
};
