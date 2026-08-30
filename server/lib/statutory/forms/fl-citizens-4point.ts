/**
 * Citizens Property Insurance four-point inspection form (Insp4pt 03 25) --
 * the published revision and the map checked against it.
 *
 * -- GENERATED FROM THE SIGNED CANDIDATE, NOT TYPED BY HAND ------------------
 * The 187 mappings below were emitted from the artifact a person signed
 * (`checkedBy: Nathan`, 2026-08-30) rather than copied. Hand-copying would
 * introduce differences the signature does not cover, and this file exists to
 * carry that signature into the software unchanged.
 *
 * -- WHICH PDF THIS IS ------------------------------------------------------
 * The four-page form Citizens publishes as `4-Point Inspection Form.pdf`, whose
 * every page footer prints `Sample Form Insp4pt 03 25`. It carries NO form
 * fields at all -- no /AcroForm, no widgets -- so every one of these mappings
 * draws at a measured coordinate. Page 3 (0-based) is instructions to agents
 * and inspectors and has no fill point on it; the map stops at page 2, and that
 * was confirmed by rasterising the page rather than inferred from the absence
 * of coordinates.
 *
 * -- THE HASH IS WRITTEN TWICE, ON PURPOSE ----------------------------------
 * Once on the revision and once on the map. A shared constant would make them
 * impossible to diverge -- and would also make that impossible to CHECK:
 * `check-statutory-fidelity.mjs` reads sha256 literals, and a constant it
 * cannot resolve reads to it as a file declaring none. A guard that cannot see
 * the thing it guards is worse than the typo it was meant to catch.
 *
 * -- THE DATES ARE THE PUBLISHER'S OWN --------------------------------------
 * Citizens' 2025-03-20 bulletin published this revision and the roof form
 * together: "Agents and Florida-licensed inspectors should begin using the
 * updated forms immediately." That date is `effectiveFrom`.
 *
 * `mandatoryFrom` is null, and that null carries POSITIVE evidence rather than
 * a gap. The same bulletin says, of an older version: "If an agent submits
 * another version of the inspection form(s), it will not be rejected." This
 * revision was never mandated, so it must not be given an invented mandate date
 * to make it look like the two forms that have one. "We could not find out" and
 * "the publisher said it is not required" are the same null in this file and
 * opposite sentences to read -- see the candidate's notes, where they are
 * written down separately.
 *
 * ⚠️ NOTHING DECLARES THIS FORM YET. Publishing the revision and its map is the
 * authority-document half. The other half is a template whose items feed these
 * field names through a `statutoryForm` declaration, and no template carries
 * one. Until one does, `available: false` is the correct and only answer any
 * workspace gets.
 */
import type { StatutoryFormVersion } from '../form-registry';
import type { FieldMap } from '../field-map';

export const version: StatutoryFormVersion = {
    formId: 'fl_citizens_4point',
    version: 'Insp4pt 03 25',
    // Citizens' 2025-03-20 bulletin: begin using the updated forms immediately.
    effectiveFrom: Date.UTC(2025, 2, 20),
    // Never mandated, on the bulletin's own words. See the file header.
    mandatoryFrom: null,
    // Still current: Citizens has published no successor as of the publish date.
    effectiveUntil: null,
    withdrawn: null,
    sourceUrl: 'https://www.citizensfla.com/documents/20702/48575/4-Point+Inspection+Form.pdf/e8c41965-f225-37fc-b451-4d360ee30b77?t=1743432185731',
    sourceHash: '5d3327663ea58cf1f073b43967004cce3205d29973aa407e200c5be1f44cc294',
    publishedBy: 'InspectorHub',
    publishedAt: Date.UTC(2026, 7, 30),
};

export const fieldMap: FieldMap = {
    formId: 'fl_citizens_4point',
    version: 'Insp4pt 03 25',
    // Written a SECOND time on purpose. See the file header.
    sourceHash: '5d3327663ea58cf1f073b43967004cce3205d29973aa407e200c5be1f44cc294',
    checkedBy: 'Nathan',
    checkedAt: Date.UTC(2026, 7, 30),
    requiredFields: [
        'insured_applicant_name',
        'address_inspected',
        'actual_year_built',
        'date_inspected',
        'electrical_panel[0].type',
        'electrical_panel[0].total_amps',
        'electrical_panel[0].amperage_sufficient',
        'electrical.general_condition',
        'hvac.central_ac',
        'hvac.central_heat',
        'hvac.systems_in_good_working_order',
        'plumbing.tprv_on_water_heater',
        'plumbing.active_leak',
        'plumbing.prior_leak',
        'roof[0].covering_material',
        'roof[0].roof_age_years',
        'roof[0].remaining_useful_life_years',
        'roof[0].overall_condition',
        'inspector_signature',
        'inspector_license_number',
        'inspector_license_type',
        'inspector_company_name',
        'inspector_signature_date',
    ],
    mappings: [
        { kind: 'overlay', ourField: 'insured_applicant_name', page: 0, x: 129.4, y: 721.4, size: 9.0, maxWidth: 216.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'application_policy_number', page: 0, x: 432.2, y: 721.4, size: 9.0, maxWidth: 114.3, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'address_inspected', page: 0, x: 111.8, y: 703.3, size: 9.0, maxWidth: 436.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'actual_year_built', page: 0, x: 103.6, y: 682.9, size: 9.0, maxWidth: 104.7, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'date_inspected', page: 0, x: 379.5, y: 682.9, size: 9.0, maxWidth: 167.4, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'dwelling_each_side', page: 0, x: 52.7, y: 643.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'roof_each_slope', page: 0, x: 142.8, y: 643.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'plumbing', page: 0, x: 226.4, y: 643.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'main_panel_with_door_label', page: 0, x: 52.7, y: 631.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'panel_off', page: 0, x: 52.7, y: 619.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'photo_requirements_included', whenValue: 'hazards_and_deficiencies', page: 0, x: 52.4, y: 607.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[0].type', whenValue: 'circuit_breaker', page: 0, x: 66.8, y: 466.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[0].type', whenValue: 'fuse', page: 0, x: 134.6, y: 466.0, size: 7.0 },
        { kind: 'overlay', ourField: 'electrical_panel[0].total_amps', page: 0, x: 88.9, y: 451.5, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[0].amperage_sufficient', whenValue: 'yes', page: 0, x: 192.2, y: 438.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[0].amperage_sufficient', whenValue: 'no', page: 0, x: 219.6, y: 438.6, size: 7.0 },
        { kind: 'overlay', ourField: 'electrical_panel[0].panel_age', page: 0, x: 84.6, y: 95.2, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'electrical_panel[0].year_last_updated', page: 0, x: 111.3, y: 80.1, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'electrical_panel[0].brand_model', page: 0, x: 93.9, y: 64.9, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[1].type', whenValue: 'circuit_breaker', page: 0, x: 336.8, y: 466.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[1].type', whenValue: 'fuse', page: 0, x: 402.5, y: 466.0, size: 7.0 },
        { kind: 'overlay', ourField: 'electrical_panel[1].total_amps', page: 0, x: 358.9, y: 451.5, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[1].amperage_sufficient', whenValue: 'yes', page: 0, x: 462.2, y: 438.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical_panel[1].amperage_sufficient', whenValue: 'no', page: 0, x: 489.6, y: 438.6, size: 7.0 },
        { kind: 'overlay', ourField: 'electrical_panel[1].panel_age', page: 0, x: 216.0, y: 94.8, size: 9.0, maxWidth: 43.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'electrical_panel[1].year_last_updated', page: 0, x: 239.5, y: 80.4, size: 9.0, maxWidth: 44.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'electrical_panel[1].brand_model', page: 0, x: 225.4, y: 66.6, size: 9.0, maxWidth: 43.4, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'electrical.conditions_present', whenValue: 'cloth_wiring', page: 0, x: 52.4, y: 390.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.conditions_present', whenValue: 'active_knob_and_tube', page: 0, x: 52.4, y: 375.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.conditions_present', whenValue: 'branch_circuit_aluminum_wiring', page: 0, x: 52.4, y: 360.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.aluminum_remediation', whenValue: 'copalum_crimp', page: 0, x: 52.4, y: 330.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.aluminum_remediation', whenValue: 'alumiconn', page: 0, x: 52.4, y: 314.8, size: 7.0 },
        { kind: 'overlay', ourField: 'electrical.aluminum_wiring_usage', page: 0, x: 363.2, y: 359.5, size: 8.0, maxWidth: 206.8, maxHeight: 10.3 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'blowing_fuses', page: 0, x: 52.7, y: 277.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'tripping_breakers', page: 0, x: 52.7, y: 262.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'empty_sockets', page: 0, x: 52.7, y: 247.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'loose_wiring', page: 0, x: 52.7, y: 232.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'improper_grounding', page: 0, x: 52.7, y: 217.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'corrosion', page: 0, x: 52.7, y: 202.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'over_fusing', page: 0, x: 52.4, y: 187.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'double_taps', page: 0, x: 322.5, y: 293.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'exposed_wiring', page: 0, x: 322.6, y: 277.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'unsafe_wiring', page: 0, x: 322.6, y: 262.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'improper_breaker_size', page: 0, x: 322.6, y: 247.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'scorching', page: 0, x: 322.6, y: 232.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.hazards_present', whenValue: 'other_explain', page: 0, x: 322.6, y: 217.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.general_condition', whenValue: 'satisfactory', page: 0, x: 212.6, y: 165.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.general_condition', whenValue: 'unsatisfactory', page: 0, x: 274.5, y: 165.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'copper', page: 0, x: 310.5, y: 92.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'copper_clad_al', page: 0, x: 400.5, y: 93.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'nm_bx_or_conduit', page: 0, x: 495.7, y: 93.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'single_strand_al', page: 0, x: 310.5, y: 81.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'cloth_knob_and_tube', page: 0, x: 400.9, y: 81.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'other', page: 0, x: 495.7, y: 80.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'multistrand_al', page: 0, x: 310.5, y: 68.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'electrical.wiring_types', whenValue: 'cloth_jacket_rubber_insulated', page: 0, x: 400.7, y: 67.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.central_ac', whenValue: 'yes', page: 1, x: 98.8, y: 677.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.central_ac', whenValue: 'no', page: 1, x: 134.8, y: 677.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.central_heat', whenValue: 'yes', page: 1, x: 98.8, y: 661.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.central_heat', whenValue: 'no', page: 1, x: 134.8, y: 661.9, size: 7.0 },
        { kind: 'overlay', ourField: 'hvac.primary_heat_source_and_fuel_type', page: 1, x: 266.2, y: 647.6, size: 9.0, maxWidth: 143.9, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'hvac.systems_in_good_working_order', whenValue: 'yes', page: 1, x: 333.0, y: 631.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.systems_in_good_working_order', whenValue: 'no', page: 1, x: 365.0, y: 631.6, size: 7.0 },
        { kind: 'overlay', ourField: 'hvac.date_of_last_servicing', page: 1, x: 185.8, y: 617.1, size: 9.0, maxWidth: 59.3, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'hvac.wood_stove_or_gas_fireplace_present', whenValue: 'yes', page: 1, x: 248.6, y: 577.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.wood_stove_or_gas_fireplace_present', whenValue: 'no', page: 1, x: 279.1, y: 577.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.professionally_installed', whenValue: 'yes', page: 1, x: 428.9, y: 577.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.professionally_installed', whenValue: 'no', page: 1, x: 460.2, y: 577.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.space_heater_as_primary_source', whenValue: 'yes', page: 1, x: 206.7, y: 562.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.space_heater_as_primary_source', whenValue: 'no', page: 1, x: 238.6, y: 562.5, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.source_is_portable', whenValue: 'yes', page: 1, x: 132.8, y: 547.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.source_is_portable', whenValue: 'no', page: 1, x: 164.8, y: 547.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.air_handler_blockage_or_leakage', whenValue: 'yes', page: 1, x: 42.5, y: 523.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'hvac.air_handler_blockage_or_leakage', whenValue: 'no', page: 1, x: 78.8, y: 522.7, size: 7.0 },
        { kind: 'overlay', ourField: 'hvac.age_of_system', page: 1, x: 99.5, y: 482.8, size: 9.0, maxWidth: 54.8, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'hvac.year_last_updated', page: 1, x: 111.5, y: 467.5, size: 9.0, maxWidth: 54.9, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'plumbing.tprv_on_water_heater', whenValue: 'yes', page: 1, x: 278.7, y: 394.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.tprv_on_water_heater', whenValue: 'no', page: 1, x: 310.7, y: 394.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.active_leak', whenValue: 'yes', page: 1, x: 192.8, y: 382.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.active_leak', whenValue: 'no', page: 1, x: 224.7, y: 382.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.prior_leak', whenValue: 'yes', page: 1, x: 183.3, y: 370.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.prior_leak', whenValue: 'no', page: 1, x: 215.1, y: 370.0, size: 7.0 },
        { kind: 'overlay', ourField: 'plumbing.water_heater_location', page: 1, x: 123.9, y: 358.5, size: 9.0, maxWidth: 206.0, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.dishwasher', whenValue: 'satisfactory', page: 1, x: 133.9, y: 312.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.dishwasher', whenValue: 'unsatisfactory', page: 1, x: 187.9, y: 312.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.dishwasher', whenValue: 'n_a', page: 1, x: 241.9, y: 312.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.refrigerator', whenValue: 'satisfactory', page: 1, x: 133.9, y: 299.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.refrigerator', whenValue: 'unsatisfactory', page: 1, x: 187.9, y: 299.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.refrigerator', whenValue: 'n_a', page: 1, x: 241.9, y: 299.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.washing_machine', whenValue: 'satisfactory', page: 1, x: 133.9, y: 287.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.washing_machine', whenValue: 'unsatisfactory', page: 1, x: 187.9, y: 287.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.washing_machine', whenValue: 'n_a', page: 1, x: 241.9, y: 287.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.water_heater', whenValue: 'satisfactory', page: 1, x: 133.9, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.water_heater', whenValue: 'unsatisfactory', page: 1, x: 187.9, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.water_heater', whenValue: 'n_a', page: 1, x: 241.9, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.showers_tubs', whenValue: 'satisfactory', page: 1, x: 133.9, y: 262.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.showers_tubs', whenValue: 'unsatisfactory', page: 1, x: 187.9, y: 262.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.showers_tubs', whenValue: 'n_a', page: 1, x: 241.9, y: 262.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.toilets', whenValue: 'satisfactory', page: 1, x: 403.7, y: 311.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.toilets', whenValue: 'unsatisfactory', page: 1, x: 457.7, y: 311.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.toilets', whenValue: 'n_a', page: 1, x: 511.7, y: 311.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sinks', whenValue: 'satisfactory', page: 1, x: 403.7, y: 299.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sinks', whenValue: 'unsatisfactory', page: 1, x: 457.7, y: 299.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sinks', whenValue: 'n_a', page: 1, x: 511.7, y: 299.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sump_pump', whenValue: 'satisfactory', page: 1, x: 403.7, y: 286.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sump_pump', whenValue: 'unsatisfactory', page: 1, x: 457.7, y: 286.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.sump_pump', whenValue: 'n_a', page: 1, x: 511.7, y: 286.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.main_shut_off_valve', whenValue: 'satisfactory', page: 1, x: 403.7, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.main_shut_off_valve', whenValue: 'unsatisfactory', page: 1, x: 457.7, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.main_shut_off_valve', whenValue: 'n_a', page: 1, x: 511.7, y: 274.7, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.all_other_visible', whenValue: 'satisfactory', page: 1, x: 403.7, y: 262.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.all_other_visible', whenValue: 'unsatisfactory', page: 1, x: 457.7, y: 262.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.fixtures.all_other_visible', whenValue: 'n_a', page: 1, x: 511.7, y: 262.6, size: 7.0 },
        { kind: 'overlay', ourField: 'plumbing.supply_piping_age.original_to_home', page: 1, x: 51.7, y: 154.7, size: 8.0, maxWidth: 19.1, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.supply_piping_age.completely_repiped', page: 1, x: 51.3, y: 139.5, size: 8.0, maxWidth: 19.1, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.supply_piping_age.partially_repiped', page: 1, x: 51.3, y: 124.4, size: 8.0, maxWidth: 19.1, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.drain_piping_age.original_to_home', page: 1, x: 222.4, y: 154.9, size: 8.0, maxWidth: 19.1, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.drain_piping_age.completely_repiped', page: 1, x: 221.8, y: 139.5, size: 8.0, maxWidth: 19.2, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.drain_piping_age.partially_repiped', page: 1, x: 221.8, y: 124.3, size: 8.0, maxWidth: 19.2, maxHeight: 10.3 },
        { kind: 'overlay', ourField: 'plumbing.water_heater_age', page: 1, x: 115.2, y: 110.1, size: 8.0, maxWidth: 43.3, maxHeight: 10.3 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'copper', page: 1, x: 350.4, y: 152.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'pex', page: 1, x: 448.5, y: 151.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'pvc_cpvc', page: 1, x: 350.0, y: 137.3, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'other', page: 1, x: 448.5, y: 137.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'galvanized', page: 1, x: 350.2, y: 121.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'cast_iron', page: 1, x: 350.2, y: 105.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'polybutylene', page: 1, x: 350.2, y: 90.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'plumbing.pipe_types', whenValue: 'abs', page: 1, x: 350.4, y: 75.6, size: 7.0 },
        { kind: 'overlay', ourField: 'plumbing.pipe_year_installed', page: 1, x: 537.5, y: 152.6, size: 7.0, maxWidth: 34.5, maxHeight: 8.5 },
        { kind: 'overlay', ourField: 'plumbing.pipe_type_other_specify', page: 1, x: 512.0, y: 138.6, size: 7.0, maxWidth: 58.0, maxHeight: 8.5 },
        { kind: 'overlay', ourField: 'roof[0].covering_material', page: 2, x: 111.3, y: 677.4, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].roof_age_years', page: 2, x: 108.2, y: 662.4, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].remaining_useful_life_years', page: 2, x: 150.0, y: 647.2, size: 9.0, maxWidth: 41.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].date_of_last_roofing_permit', page: 2, x: 140.3, y: 631.9, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[0].date_of_last_update', page: 2, x: 115.8, y: 616.8, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[0].update_extent', whenValue: 'full_replacement', page: 2, x: 52.4, y: 585.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].update_extent', whenValue: 'partial_replacement', page: 2, x: 52.4, y: 570.4, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[0].percent_of_replacement', page: 2, x: 127.6, y: 555.9, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[0].overall_condition', whenValue: 'satisfactory', page: 2, x: 52.4, y: 524.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].overall_condition', whenValue: 'unsatisfactory', page: 2, x: 52.4, y: 509.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cracking', page: 2, x: 52.4, y: 464.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cupping_curling', page: 2, x: 52.4, y: 451.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'excessive_granule_loss', page: 2, x: 52.4, y: 439.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'exposed_asphalt', page: 2, x: 52.4, y: 427.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'exposed_felt', page: 2, x: 52.4, y: 414.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'missing_loose_cracked_tabs_or_tiles', page: 2, x: 52.4, y: 402.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'soft_spots_in_decking', page: 2, x: 52.4, y: 390.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'visible_hail_damage', page: 2, x: 52.5, y: 378.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].visible_signs_of_leaks', whenValue: 'yes', page: 2, x: 153.6, y: 363.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].visible_signs_of_leaks', whenValue: 'no', page: 2, x: 185.6, y: 363.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_attic_underside_of_decking', whenValue: 'yes', page: 2, x: 143.0, y: 351.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_attic_underside_of_decking', whenValue: 'no', page: 2, x: 174.8, y: 351.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_interior_ceilings', whenValue: 'yes', page: 2, x: 105.1, y: 338.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[0].leaks_interior_ceilings', whenValue: 'no', page: 2, x: 137.0, y: 338.8, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[1].covering_material', page: 2, x: 382.5, y: 677.4, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].roof_age_years', page: 2, x: 379.4, y: 662.4, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].remaining_useful_life_years', page: 2, x: 421.2, y: 647.2, size: 9.0, maxWidth: 41.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].date_of_last_roofing_permit', page: 2, x: 411.5, y: 631.9, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'roof[1].date_of_last_update', page: 2, x: 387.0, y: 616.8, size: 9.0, maxWidth: 41.5, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[1].update_extent', whenValue: 'full_replacement', page: 2, x: 319.4, y: 585.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].update_extent', whenValue: 'partial_replacement', page: 2, x: 319.4, y: 570.4, size: 7.0 },
        { kind: 'overlay', ourField: 'roof[1].percent_of_replacement', page: 2, x: 394.6, y: 555.9, size: 9.0, maxWidth: 41.6, maxHeight: 11.0 },
        { kind: 'checkbox', ourField: 'roof[1].overall_condition', whenValue: 'satisfactory', page: 2, x: 319.4, y: 524.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].overall_condition', whenValue: 'unsatisfactory', page: 2, x: 319.4, y: 509.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'cracking', page: 2, x: 323.6, y: 464.0, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'cupping_curling', page: 2, x: 323.6, y: 451.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'excessive_granule_loss', page: 2, x: 323.6, y: 439.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'exposed_asphalt', page: 2, x: 323.6, y: 427.2, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'exposed_felt', page: 2, x: 323.6, y: 414.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'missing_loose_cracked_tabs_or_tiles', page: 2, x: 323.6, y: 402.9, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'soft_spots_in_decking', page: 2, x: 323.6, y: 390.6, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].damage_signs', whenValue: 'visible_hail_damage', page: 2, x: 323.7, y: 378.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].visible_signs_of_leaks', whenValue: 'yes', page: 2, x: 424.8, y: 363.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].visible_signs_of_leaks', whenValue: 'no', page: 2, x: 456.8, y: 363.4, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_attic_underside_of_decking', whenValue: 'yes', page: 2, x: 414.2, y: 351.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_attic_underside_of_decking', whenValue: 'no', page: 2, x: 446.0, y: 351.1, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_interior_ceilings', whenValue: 'yes', page: 2, x: 376.3, y: 338.8, size: 7.0 },
        { kind: 'checkbox', ourField: 'roof[1].leaks_interior_ceilings', whenValue: 'no', page: 2, x: 408.2, y: 338.8, size: 7.0 },
        { kind: 'overlay', ourField: 'additional_comments', page: 2, x: 45.0, y: 270.0, size: 9.0, maxWidth: 525.0, maxHeight: 64.0 },
        { kind: 'overlay', ourField: 'inspector_signature', page: 2, x: 43.2, y: 142.2, size: 9.0, maxWidth: 136.0, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_title', page: 2, x: 190.0, y: 143.1, size: 9.0, maxWidth: 112.9, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_license_number', page: 2, x: 313.8, y: 143.1, size: 9.0, maxWidth: 131.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_signature_date', page: 2, x: 456.4, y: 142.2, size: 9.0, maxWidth: 114.8, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_company_name', page: 2, x: 43.2, y: 103.0, size: 9.0, maxWidth: 136.0, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_license_type', page: 2, x: 190.0, y: 103.9, size: 9.0, maxWidth: 112.9, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'inspector_work_phone', page: 2, x: 313.8, y: 103.9, size: 9.0, maxWidth: 131.4, maxHeight: 11.0 },
        { kind: 'overlay', ourField: 'plumbing_fixtures_unsatisfactory_detail', page: 1, x: 43.98, y: 232.8, size: 9.0, maxWidth: 530.0, maxHeight: 46.94 },
    ],
};
