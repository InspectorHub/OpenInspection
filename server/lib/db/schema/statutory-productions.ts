import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * One row per statutory form actually produced.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `produceStatutoryForm` resolves a revision and returns it, and until this
 * table nothing kept it. So "which reports were produced with revision X" had
 * no answer -- which makes a recall impossible, and a wrong field map is the
 * one fault in this subsystem that has already put an incorrect official
 * document in someone else's hands.
 *
 * ── WHY EVERY PRODUCTION, NOT THE LATEST ────────────────────────────────────
 * A re-issue is a second delivery. Collapsing the two would understate how many
 * documents are out there, which is the number a recall is about. There is no
 * unique index on (inspection, form, revision) on purpose.
 *
 * ── NO PERSONAL DATA ────────────────────────────────────────────────────────
 * Ids, a form id, a revision label and a hash. Nothing from the form's content.
 *
 * No `.references()` per Schema Rules -- D1 cannot rebuild a table an FK points
 * at, so every id here is a soft reference.
 */
export const statutoryFormProductions = sqliteTable('statutory_form_productions', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    /**
     * The FORM, never one of its revisions -- e.g. `tx_trec_rei`. Same
     * vocabulary as `statutory_form_versions.form_id`, so the recall query can
     * join the two by hand.
     */
    formId: text('form_id').notNull(),
    /** The authority's own revision label, verbatim -- `7-6`, `Rev. 04/26`. */
    version: text('version').notNull(),
    /**
     * sha256 (lowercase hex) of the exact PDF bytes rendered onto. The revision
     * label says which document was meant; this says which bytes were actually
     * used, and only the second one can be checked against a field map.
     */
    sourceHash: text('source_hash').notNull(),
    /** users.id of whoever asked for the document. Soft reference. */
    producedBy: text('produced_by').notNull(),
    producedAt: integer('produced_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // The recall query: everyone affected by one (form, revision).
    index('idx_statutory_productions_form_version').on(t.formId, t.version),
    // The per-inspection read: what this workspace produced for one visit.
    index('idx_statutory_productions_inspection').on(t.tenantId, t.inspectionId),
]);

export type StatutoryFormProductionRow = typeof statutoryFormProductions.$inferSelect;
export type NewStatutoryFormProductionRow = typeof statutoryFormProductions.$inferInsert;
