import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * A preservation obligation that outranks every scheduled deletion.
 *
 * review review made this a global invariant rather than a per-table note:
 * a record within the scope of a legal hold, dispute, regulatory investigation
 * or DSAR/complaint preservation must not be removed by an ordinary retention
 * sweep until the hold is released. Without it, every window in
 * `retention-manifest.ts` is a promise the first preservation request breaks —
 * the numbers stop being a governance choice and become an upper bound the
 * platform enforces against its own legal interest.
 *
 * ── A hold covers a tenant, not a row ───────────────────────────────────────
 * There is no scope column, and that is a decision rather than a first cut.
 * A narrow hold has to enumerate what it covers BEFORE anyone knows what the
 * matter will turn out to need, and every record it failed to name gets deleted
 * on schedule while a hold is nominally in force — which is the worst of the
 * available outcomes, because the hold's existence is what makes the deletion
 * look considered. Widening later is additive and safe; discovering a gap after
 * the sweep ran is not. Over-preservation under a recorded hold is a defensible
 * posture; under-preservation is spoliation.
 *
 * ── Released, not deleted ───────────────────────────────────────────────────
 * `releasedAt` is nullable and a released row STAYS. A boolean, or a delete,
 * would leave no way to answer the question that actually gets asked later:
 * over which period was this tenant's data preserved, and who decided it no
 * longer had to be. The hold is itself a record about a legal matter, so this
 * table appears in `retention-out-of-scope` — a hold that expired on its own
 * schedule would be a preservation record that failed to preserve itself.
 *
 * ── Why `matter` is NOT NULL ────────────────────────────────────────────────
 * A hold with no matter reference can be placed but never responsibly released:
 * the person deciding whether it still applies has nothing to check it against,
 * so the safe answer is always "leave it", and the platform accumulates holds
 * nobody can retire. Requiring the reference at placement is what keeps release
 * a decision rather than a guess.
 */
export const legalHolds = sqliteTable('legal_holds', {
    id: text('id').primaryKey(),
    /** Multi-tenant isolation, per the Schema Rules. The unit of a hold. */
    tenantId: text('tenant_id').notNull(),
    /**
     * The matter this hold exists for — a case number, regulator reference,
     * complaint ID or DSAR ID. Free text because the issuing authority decides
     * its shape, required because release depends on it (see the header).
     */
    matter: text('matter').notNull(),
    /**
     * Why preservation is required, in a sentence a later reader can evaluate.
     * Separate from `matter`: the reference identifies the proceeding, this
     * says what about it reaches this tenant's data.
     */
    reason: text('reason').notNull(),
    /**
     * Who placed it. A user id where a human did, or a system actor name where
     * an automated preservation trigger did. Not a foreign key: the person who
     * placed a hold may leave before it is released, and the hold must not
     * become unreadable because their account did.
     */
    placedBy: text('placed_by').notNull(),
    placedAt: integer('placed_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * NULL while the hold is in force. The sweep's entire definition of "active"
     * is this column being NULL — deliberately one condition, because a hold
     * whose activeness is computed from several fields is a hold that can be
     * accidentally inactive.
     */
    releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
    releasedBy: text('released_by'),
    /** Why it was safe to release. Null while in force; expected once released. */
    releaseReason: text('release_reason'),
}, (t) => [
    // The sweep's only read: active holds, by tenant. Partial-index semantics
    // are not available here, so the null-ness of `released_at` is filtered in
    // the query and this index just keeps the scan tenant-ordered.
    index('idx_legal_holds_tenant_active').on(t.tenantId, t.releasedAt),
]);
