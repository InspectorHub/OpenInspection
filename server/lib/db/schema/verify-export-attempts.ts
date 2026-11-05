import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Attempt counters for the signed audit export of an envelope (POST /api/public/verify/:envelopeId/export).
 *
 * One row per counter key. A key is a pure function of what is being limited (the envelope, or the envelope together with the
 * calling address and the kind of answer given), so no row names a person and none carries a company id: the envelope id is the
 * public identifier already printed on the verification page.
 *
 * The counter is reserved BEFORE the answer is compared, by one upsert statement that adds one and returns the new count. That is
 * what makes it a cap: a read followed by a write lets parallel requests all read the same number, and a key-value store is
 * eventually consistent besides. A window opens at its first attempt and is never extended; an attempt that turns out right is
 * handed back, so successes do not use up the allowance.
 *
 * The table deliberately has no tenant_id: it is keyed by the public envelope id and swept by the retention rule, so it is not tenant data.
 *
 * Rows are short-lived (the longest window is an hour) and exist only for envelopes that exist. A row whose window has ended is
 * replaced by the next attempt on its key; rows nobody comes back to are removed by the scheduled retention sweep (rule for
 * verify_export_attempts). The key holds a keyed hash of the caller's network, never an address.
 */
export const verifyExportAttempts = sqliteTable('verify_export_attempts', {
    key:          text('key').primaryKey(),
    attempts:     integer('attempts').notNull(),
    windowEndsAt: integer('window_ends_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // The sweep read: "which windows have ended?"
    index('idx_verify_export_attempts_ends').on(t.windowEndsAt),
]);

export type VerifyExportAttempt = typeof verifyExportAttempts.$inferSelect;
