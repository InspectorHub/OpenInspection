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
