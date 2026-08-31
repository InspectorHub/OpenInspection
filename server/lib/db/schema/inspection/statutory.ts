import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * One inspection's answers to one statutory form.
 *
 * -- WHY ONE ROW PER FORM, NOT PER FIELD -------------------------------------
 * A document's answers are only ever read and written whole. The Texas form has
 * 250 fields and the superseded Florida one had 205; splitting those into rows
 * pays bookkeeping for something that always happens as a unit.
 *
 * -- WHY N ROWS PER INSPECTION IS THE DESIGN ---------------------------------
 * `form_id` is in the key. A Florida house commonly gets a four-point AND a
 * wind-mitigation form on the same visit: two documents, two sets of answers,
 * two completeness states, two signatures.
 *
 * -- WHY NOT A COLUMN ON `inspections` ---------------------------------------
 * Preference rather than necessity: that table is close to D1's column ceiling.
 *
 * -- NO PERSONAL DATA IN `values` --------------------------------------------
 * Client identity reaches a form through `from: 'inspection'` bindings and
 * signatures through `from: 'signature'` references, so neither travels here.
 * `binding-policy.ts` enforces that rather than trusting it.
 */
export const statutoryFormEntries = sqliteTable('statutory_form_entries', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    /** The form, never a revision -- which revision applies is the date's answer. */
    formId:       text('form_id').notNull(),
    /** JSON `Record<string, string>`. Carries no personal data. */
    values:       text('values', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_statutory_form_entries_subject')
        .on(t.tenantId, t.inspectionId, t.formId),
    index('idx_statutory_form_entries_inspection').on(t.tenantId, t.inspectionId),
]);

/**
 * The inspection-level answers an authority's form asks for and no other part
 * of this product has ever needed.
 *
 * -- WHY THESE ARE NOT COLUMNS ON `inspections` ------------------------------
 * The same reason the table above gives, measured: `inspections` is 76 columns
 * wide against D1's hard limit of 100, and `check-column-ceiling.mjs` starts
 * ratcheting at 85. Eight more would leave one column of room on the table
 * every feature in this product touches, to serve a document most deployments
 * never produce.
 *
 * -- WHY NOT IN `statutory_form_entries.values` ------------------------------
 * That column is DECLARED to carry no personal data, and `binding-policy.ts`
 * enforces the declaration. Six of the eight fields here are a named human
 * being's contact details. They reach a form the way every other person on it
 * does — a `from: 'inspection'` binding resolved out of `facts` — and that is
 * the route the policy admits for personal data.
 *
 * -- WHY ONE ROW PER INSPECTION AND NOT PER FORM -----------------------------
 * Unlike the answers above, none of these is a question a particular form
 * asked. Who owns the house, and when the inspector signed for the visit, are
 * the same facts whichever of the day's forms is being produced; keying them by
 * form would let a Florida house's four-point and wind-mitigation forms carry
 * two different owners and give nobody a reason to notice.
 *
 * -- 🔴 THE OWNER IS NOT THE CLIENT ------------------------------------------
 * `owner_*` is deliberately not read from, defaulted from, or backfilled out of
 * the inspection's primary client. A buyer commissions the inspection and the
 * seller owns the house, which is the ordinary case rather than the edge one.
 * Binding one to the other prints the wrong person's name on a state form and
 * every gate stays green, because no gate reads meaning.
 *
 * ⚠️ THE SIGNING DATE IS NOT THE INSPECTION DATE. Signing commonly happens days
 * after the fieldwork, and the Citizens roof form prints both — page 1's "Date
 * of Inspection" and page 2's "Date" under the certification sentence. Binding
 * the two together would make one of them false with nothing on the page to say
 * which.
 */
export const statutoryInspectionDetails = sqliteTable('statutory_inspection_details', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    /** Calendar day, `YYYY-MM-DD` — a signature is dated, never timestamped, on
     *  every form measured. Text for the same reason `due_date` is. */
    inspectorSignatureDate: text('inspector_signature_date'),
    /** The second signer on FL OIR-B1-1802 page 5: the employee of the entity
     *  the inspector works for, printed rather than signed. */
    employeePrintedName:    text('employee_printed_name'),
    ownerName:              text('owner_name'),
    ownerEmail:             text('owner_email'),
    /** Where the owner receives post, which is NOT `property_address`: an
     *  absentee owner is exactly who a mailing address is asked for. */
    ownerMailingAddress:    text('owner_mailing_address'),
    /** Three of them, because the form prints three boxes. Collapsing them into
     *  one and splitting it later loses which number the owner gave for what. */
    ownerHomePhone:         text('owner_home_phone'),
    ownerWorkPhone:         text('owner_work_phone'),
    ownerCellPhone:         text('owner_cell_phone'),
    updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_statutory_inspection_details_subject')
        .on(t.tenantId, t.inspectionId),
]);
