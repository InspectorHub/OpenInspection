import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { AUTHORITY_BASES } from '../../../auth/authority-basis';

/**
 * What the person accepted, recorded where the account was born.
 *
 * review A2's invariant is that an account and its acceptance are ONE write. The
 * mechanism this table exists to serve is deliberately not the obvious one: the
 * first design enqueued the acceptance atomically with the account insert and let
 * the portal ledger become consistent afterwards, and review refused it —
 * `FAIL-CLOSED NOT SATISFIED` (review, decision). The distinction they drew is
 * between two things that design treated as one: an outbox proves *acceptance
 * evidence was durably captured*; it cannot prove *acceptance was recorded in the
 * acceptance ledger before account creation*. While the event sits unconsumed the
 * state is `account = EXISTS, acceptance_ledger = ABSENT`, which violates the
 * invariant no matter what the envelope contains.
 *
 * So rows here are written in the SAME `db.batch()` as the `users` row, and the
 * builder that produces them returns a statement rather than executing one, so
 * the caller can put it in its own batch. There is no path that writes an
 * acceptance on its own, and none that creates an account without one.
 *
 * ── One row per document, not one row with a list ───────────────────────────
 * A person accepts Terms and a Privacy notice as separate documents with separate
 * versions and separate hashes. Folding them into a JSON array would make "which
 * version of Terms did they accept" a query into a blob, and would let a partial
 * capture (one document present, one missing) look like a complete row. Separate
 * rows make the absence visible.
 *
 * ── The relationship to portal's `user_consents` ────────────────────────────
 * For an account born HERE, this table is the record and the portal ledger is a
 * projection of it. For an account born in the portal, the reverse: the portal
 * captured the acceptance and it travels in on the command. Whoever captured it
 * is authoritative; the other side projects. Both directions are real, and
 * confusing them is how a reader concludes one of them does not exist.
 */
export const accountAcceptances = sqliteTable('account_acceptances', {
    id: text('id').primaryKey(),
    /** Multi-tenant isolation, per the Schema Rules. */
    tenantId: text('tenant_id').notNull(),
    /** The `users` row this acceptance was committed alongside. */
    userId: text('user_id').notNull(),
    /**
     * The portal `identities.id` the acceptance was captured against, when it was
     * captured over there. NULL for an acceptance captured on this side, which has
     * no portal identity behind it — a standalone deployment has no portal at all.
     */
    actorIdentityRef: text('actor_identity_ref'),
    /** Which document. Free text rather than an enum: the set of documents a
     *  deployment publishes is the deployment's business, and refusing an unknown
     *  one at the seam is the boundary's job, not the column's. */
    doc: text('doc').notNull(),
    /** `YYYY-MM-DD`, the version the person was shown. */
    version: text('version').notNull(),
    /** SHA-256 hex of the body shown. What was SHOWN, not where it lived. */
    contentHash: text('content_hash').notNull(),
    /**
     * On what basis this binds anyone — see `lib/auth/authority-basis.ts`.
     * Deliberately separate from any role column: role is an operational fact and
     * says nothing about signing authority.
     */
    authorityBasis: text('authority_basis', { enum: AUTHORITY_BASES }).notNull(),
    /**
     * When the HUMAN accepted, epoch ms — not when this row was written.
     *
     * On the portal-originated path those differ by however long the onboarding
     * workflow took, and collapsing them would forge the legal fact to match the
     * plumbing. The portal's block carries the human's timestamp for exactly this
     * reason and it is copied through unchanged.
     */
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }).notNull(),
    /** When this row was written. Distinct from the above, on purpose. */
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // One acceptance per (user, document, version). A retried command that
    // re-delivers the same acceptance must not mint a second row — the seam is
    // at-least-once, and a duplicate here would read as the person having
    // accepted twice.
    uniqueIndex('uq_account_acceptances_user_doc_version').on(t.userId, t.doc, t.version),
    index('idx_account_acceptances_tenant').on(t.tenantId, t.acceptedAt),
]);
