import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Track I-a GDPR (spec §4) — append-only DSAR (data-subject erasure) decision
 * record. Required by GDPR Art. 5(2) + Art. 30 (accountability: you must be
 * able to prove you honored an erasure request). Deliberately a PLATFORM-LEVEL
 * table with NO foreign key to `tenants` (matches `tenant_destruction_records`
 * / `audit_logs` posture for records that must survive their subject rows).
 *
 * Itself stores `subject_email` (that IS PII), but it is the legally-required
 * accountability record and is exempt from erasure — you cannot prove you
 * honored a request if you delete the record of it. Documented as a
 * retain-by-obligation row; a future Cron sweep MAY hash subject_email past a
 * long window (out of scope v1).
 *
 * `decisions_json` is a serialized array of
 *   [{ table, action: delete|null|hash|retain|anonymize, count, legalBasis?, retentionExpiry? }].
 */
export const erasureLog = sqliteTable('erasure_log', {
    id:              text('id').primaryKey(),
    tenantId:        text('tenant_id').notNull(),
    // The data subject (client) whose erasure was requested.
    subjectEmail:    text('subject_email').notNull(),
    // The admin/user sub who ran the erasure (accountability). Nullable for
    // system-initiated runs.
    requestedBy:     text('requested_by'),
    // How the subject's identity was verified — free text or 'admin_action'.
    identityBasis:   text('identity_basis'),
    status:          text('status', { enum: ['completed', 'partially_completed', 'refused'] }).notNull(),
    // Serialized decision array (see file docblock).
    decisionsJson:   text('decisions_json').notNull(),
    // Rows kept under an exemption (signed evidence retained).
    retainedCount:   integer('retained_count').notNull().default(0),
    anonymizedCount: integer('anonymized_count').notNull().default(0),
    deletedCount:    integer('deleted_count').notNull().default(0),
    // What we told the subject (refusal reasons / summary).
    responseNote:    text('response_note'),
    // Unix ms.
    createdAt:       integer('created_at').notNull(),
}, (t) => [
    index('idx_erasure_log_tenant').on(t.tenantId, t.createdAt),
]);
