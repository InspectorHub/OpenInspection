import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Commercial PCA Phase M — ASTM E2018 compliance artifacts. All three tables
 * are inspection-scoped sub-records, populated only for `report_tier =
 * full_pca` reports (Phase T owns the tier column). No `.references()` FKs:
 * D1 cannot rebuild FK-referenced tables, so referential integrity is enforced
 * at the service layer (ScopedDB + tenant filters). See #PR for context.
 */

/**
 * Dual sign-off (ASTM §7.5 / §X1.1.2.1): the field observer who performed the
 * walk-through and the PCR reviewer who exercises responsible control. One row
 * per (inspection, role). `signature_ref` is the base64url Ed25519 signature
 * over the canonical attestation payload (server/lib/pca-attestation.ts), signed
 * with the tenant signing key (reused from e-sign). `dual_role` is true when one
 * person holds both roles (§7.6) — then two rows exist, both flagged.
 */
export const reportSignoff = sqliteTable('report_signoff', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull(),
    inspectionId:      text('inspection_id').notNull(),
    role:              text('role', { enum: ['field_observer', 'pcr_reviewer'] }).notNull(),
    // The user/identity sub of the signer (accountability). Free text — no FK.
    personId:          text('person_id').notNull(),
    name:              text('name').notNull(),
    // Professional license number as displayed in Appendix D qualifications.
    license:           text('license'),
    // Pointer to the qualifications narrative/exhibit (free text key; Appendix D).
    qualificationsRef: text('qualifications_ref'),
    // Unix ms.
    signedAt:          integer('signed_at', { mode: 'timestamp_ms' }).notNull(),
    // base64url Ed25519 signature over the attestation payload.
    signatureRef:      text('signature_ref').notNull(),
    dualRole:          integer('dual_role', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
    index('idx_report_signoff_inspection').on(t.tenantId, t.inspectionId),
    uniqueIndex('uq_report_signoff_role').on(t.inspectionId, t.role),
]);

/**
 * Pre-Survey Questionnaire (ASTM §8.5) — one row per inspection. `responses` is
 * the structured questionnaire JSON (history of repairs/costs, preventive-
 * maintenance level, pending repairs, known deficiencies, system ages,
 * warranties, litigation, occupancy, …). Rendered as Appendix E exhibit. A
 * `declined` PSQ must be disclosed in Deviations (Phase S store, via M's append).
 * `share_token` reuses the client-portal token pattern for a no-login fill form.
 */
export const psqResponses = sqliteTable('psq_responses', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    responses:    text('responses', { mode: 'json' }).$type<Record<string, unknown>>(),
    status:       text('status', { enum: ['sent', 'received', 'declined'] }).notNull().default('sent'),
    // Persistent per-inspection share token for the no-login PSQ form (mirrors
    // the inspection_access_tokens model; opaque, server-issued).
    shareToken:   text('share_token'),
    sentAt:       integer('sent_at', { mode: 'timestamp_ms' }),
    receivedAt:   integer('received_at', { mode: 'timestamp_ms' }),
    updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_psq_inspection').on(t.tenantId, t.inspectionId),
    uniqueIndex('idx_psq_share_token').on(t.shareToken),
]);

/**
 * Document Review checklist (ASTM §8.6) — one row per checklist item per
 * inspection. ~15 owner/user documents (C-of-O, code/fire violations, prior
 * PCRs, drawings/specs, rent roll, ADA/FHA evals, system-age records, repair
 * costs, warranties, appraisals, …) plus the Zoning Compliance / Previous
 * Reports sub-items. Items not provided are stated as limitations, never dropped.
 */
export const documentReviewItems = sqliteTable('document_review_items', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    // Stable key from the seed catalog (server/lib/pca-document-catalog.ts).
    documentKey:  text('document_key').notNull(),
    label:        text('label').notNull(),
    requested:    integer('requested', { mode: 'boolean' }).notNull().default(false),
    received:     integer('received', { mode: 'boolean' }).notNull().default(false),
    reviewed:     integer('reviewed', { mode: 'boolean' }).notNull().default(false),
    na:           integer('na', { mode: 'boolean' }).notNull().default(false),
    notes:        text('notes'),
    sortOrder:    integer('sort_order').notNull().default(0),
}, (t) => [
    index('idx_doc_review_inspection').on(t.tenantId, t.inspectionId),
    uniqueIndex('uq_doc_review_item').on(t.inspectionId, t.documentKey),
]);
