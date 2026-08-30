/**
 * The erasure rules for the owner block an authority's form prints.
 *
 * A part of `ERASURE_MANIFEST`, not a second manifest — spread back into that
 * array at the position these rules occupy. Same reason as
 * `erasure-manifest-reports.ts`: the parent file sits at its large-file cap,
 * and a rule that will not fit is not grounds for raising the cap on an
 * accountability record. It is grounds for cutting one along a subject
 * boundary, and "the people named on a statutory form" is a boundary that will
 * still make sense in a year.
 *
 * ⚠️ `scripts/check-erasure-manifest.mjs` reads the manifest as SOURCE TEXT and
 * resolves every spread inside it against this directory, hard-failing on one
 * it cannot find. So this file is seen; a split it could not follow would halve
 * what the gate counts while it went on reporting OK.
 *
 * ## What these columns are
 *
 * `statutory_inspection_details` holds the answers only an authority's form has
 * ever asked for: who owns the property, how to reach them, when the inspector
 * signed, and the second signer FL OIR-B1-1802 prints. One row per inspection.
 *
 * ## Why NULL rather than the `retain` its neighbours get
 *
 * `inspections.property_address` and its family are retained under Art. 17(3)(e)
 * because an address identifies the SUBJECT MATTER of a record a tenant may
 * have to defend. A phone number for the person who owned the house does not,
 * and once that inspection's client is erased there is no purpose left that
 * these serve. Clearing them costs the tenant nothing they can point at, so the
 * tighter answer is the one taken — rather than a `retain` that would need a
 * legal basis to justify it.
 *
 * ## 🔴 The owner is not the subject, and this is not their request
 *
 * They have no account, no contact row and no login, so no erasure request ever
 * arrives in their name. These clear because the inspection they were attached
 * to lost its purpose, not because they asked. The executor reaches them
 * through the subject's inspections for exactly that reason —
 * `erase-statutory-details.ts`.
 *
 * ## What is NOT here
 *
 * `inspector_signature_date` is in `ERASURE_OUT_OF_SCOPE` with its reason: it
 * is the day a member of STAFF signed, which is a fact about the document
 * rather than a consumer data subject's personal data. It sits on the same row
 * and is a different question.
 *
 * ⚠️ A form already PRODUCED still carries what was printed on it. These rules
 * clear the SOURCE, not the delivered PDF; that document is governed by the
 * report-deliverable rules and expires on its own schedule.
 */
import type { ErasureRule } from './erasure-manifest';

export const STATUTORY_DETAIL_ERASURE_RULES: ErasureRule[] = [
    { table: 'statutory_inspection_details', column: 'owner_name',            category: 'user.name',          action: 'null' },
    { table: 'statutory_inspection_details', column: 'owner_email',           category: 'user.contact.email', action: 'null' },
    { table: 'statutory_inspection_details', column: 'owner_mailing_address', category: 'user.address',       action: 'null' },
    { table: 'statutory_inspection_details', column: 'owner_home_phone',      category: 'user.contact.phone', action: 'null' },
    { table: 'statutory_inspection_details', column: 'owner_work_phone',      category: 'user.contact.phone', action: 'null' },
    { table: 'statutory_inspection_details', column: 'owner_cell_phone',      category: 'user.contact.phone', action: 'null' },
    { table: 'statutory_inspection_details', column: 'employee_printed_name', category: 'user.name',          action: 'null' },
];
