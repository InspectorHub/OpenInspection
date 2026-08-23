import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * An immutable record of what a tenant's Privacy Policy and Terms actually SAID,
 * each time they changed.
 *
 * WHY THIS STORES THE BODY AND NOT JUST A HASH. The platform's own documents
 * live in a repository, so a version registry there can hash the text and let
 * git hold it. A tenant's `tenant_configs.privacy_body` is a mutable TEXT column
 * that the next save overwrites, with nothing behind it. A hash-only row would
 * therefore prove that the text changed while being unable to produce the text
 * that changed — failing at exactly the moment somebody needs it. The shape here
 * is copied from this codebase's own agreement envelope
 * (`agreement_requests.content_snapshot` / `.content_hash`), which solved the
 * same problem for the same reason.
 *
 * WHAT A ROW MEANS. One publish of one document. `version` is a DATE STRING and
 * the inspection Agreement's is an auto-increment integer; the formats differ on
 * purpose, so a reader can never mistake one object for the other. They share no
 * table, no counter and no acceptance flow — a company policy is one per tenant
 * and shown in a footer, while an Agreement is N per order, signed by named
 * parties, and gates the report.
 *
 * SAME-DAY REPUBLISH COLLAPSES, and that is a property rather than an accident:
 * `(tenant, doc, version)` is unique, so several saves on one date leave the row
 * that ENDED that date — which is the text that was actually in force when the
 * date closed. Nothing depends on the intermediate ones, because OI records no
 * acceptance against these documents (re-acceptance is deliberately not built:
 * a client has no account, so the only place to interrupt them is the report
 * path that already carries a pay-gate and a sign-gate).
 *
 * `is_material` is recorded from day one even though nothing reads it yet, so
 * that per-tenant, material-only re-acceptance stays possible without a
 * backfill that would have to guess.
 */
export const tenantLegalVersions = sqliteTable('tenant_legal_versions', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /**
     * Which document. It is the discriminator in the uniqueness key and in every
     * "latest in force" lookup, so the two version independently — saving Terms
     * never mints a Privacy row. The retention sweep deletes a row only when a
     * NEWER version exists for the same `(tenant, doc)`, which is what keeps the
     * current text of each one undeletable.
     */
    /**
     * Two values, and `agent_terms` is deliberately NOT one of them any more.
     *
     * It was, on the reasoning that in standalone the operator IS the single
     * tenant. That was settled the other way: one Agent
     * acceptance covers the whole deployment, so the ledger is
     * `agent × terms version` and never `agent × company × terms version`. An
     * agent is a `users` row with `tenant_id IS NULL` and its counterparty is
     * whoever operates the deployment, so the document has no tenant to be keyed
     * on — it lives in `deployment_legal_versions` (schema/compliance.ts).
     *
     * The value is removed rather than left unused. Keeping it would leave a
     * legal home that the ruling forbids using, and the next person wiring agent
     * terms would find it and be right to assume it was the intended one.
     */
    doc: text('doc', { enum: ['privacy', 'terms'] }).notNull(),
    /** `YYYY-MM-DD` in the tenant's own timezone — the date a reader is shown. */
    version: text('version').notNull(),
    /**
     * The document body as published. NULL means the tenant cleared their
     * override and reverted to the built-in template — which is a publish, and
     * is recorded as one, because "they went back to the default" is exactly the
     * kind of change a missing row would silently hide.
     */
    bodySnapshot: text('body_snapshot'),
    /** SHA-256 hex of `bodySnapshot` (of the empty string when it is NULL). */
    contentHash: text('content_hash').notNull(),
    isMaterial: integer('is_material', { mode: 'boolean' }).notNull().default(false),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
    /** The staff user who saved it; NULL for a system-originated publish. */
    publishedByUserId: text('published_by_user_id'),
}, (t) => [
    uniqueIndex('idx_tenant_legal_versions_doc_version').on(t.tenantId, t.doc, t.version),
    index('idx_tenant_legal_versions_latest').on(t.tenantId, t.doc, t.publishedAt),
]);
