import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * People who told us not to look them up.
 *
 * `GET /api/integration/tenants/by-email` answers, for one address, WHICH
 * inspection companies hold a live report grant for it. That is a cross-tenant
 * statement about a person's relationships, assembled by the platform rather
 * than by any single company, and this table is how a person stops it. The
 * lookup consults it FIRST and, on a hit, answers exactly as it answers for an
 * address it has never seen.
 *
 * ── Why there is no `tenant_id`, stated rather than bolted on ───────────────
 * Every other table here carries one because it holds a company's data. This
 * one holds an OBJECTION TO A PLATFORM ACT: the scan has no tenant in scope,
 * and the person raising it does not know — and must not have to enumerate —
 * which companies hold grants for them. A tenant-scoped objection would be
 * unexercisable by the only party entitled to exercise it, and would have to be
 * re-filed every time a new company acquired a grant. The scope column would be
 * a lie about what the row means, so it is absent by decision.
 *
 * `tenant_slug_history` above records the sibling case where `tenant_id` IS the
 * scope; this is the case where there is no scope at all.
 *
 * ── Why the address is hashed ──────────────────────────────────────────────
 * Kept as SHA-256 of the normalised address (trimmed, lower-cased) because the
 * only question ever asked of this table is "did THIS address object", and a
 * legible column would additionally be a browsable directory of the people who
 * objected — a list we have no purpose for. The hash is UNSALTED and therefore
 * confirmable by anyone holding a candidate address; that is the point (the
 * lookup must be able to check it) and it is not claimed as a security control.
 *
 * ── Erasure posture ────────────────────────────────────────────────────────
 * Same shape as `email_suppressions`: the row IS the mechanism that keeps
 * honouring the objection, so deleting it on an erasure request would silently
 * resume the processing the person objected to.
 */
export const discoveryObjections = sqliteTable('discovery_objections', {
    id: text('id').primaryKey(),
    // SHA-256 hex of the normalised address. The lookup key, and the only
    // identifier in the row.
    emailHash: text('email_hash').notNull(),
    // How control of the address was proven when the objection was filed. One
    // member today, declared as an enum because the answer is evidence: a
    // future authenticated surface (a portal account, a verified-email
    // challenge) is a DIFFERENT proof standard and must be distinguishable in
    // the record from this one rather than merged into it.
    provedBy: text('proved_by', { enum: ['inspection_access_token'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Set instead of deleting the row, so the period during which the objection
    // was in force stays answerable. A withdrawn row is inert: the lookup
    // requires this to be NULL. Re-filing clears it rather than inserting a
    // second row.
    withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
}, (t) => [
    // One live answer per address — the state, not a log of requests.
    uniqueIndex('uq_discovery_objections_email_hash').on(t.emailHash),
]);

export type DiscoveryObjection = typeof discoveryObjections.$inferSelect;
