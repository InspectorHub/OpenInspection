/**
 * FIXTURE — the schema half of the probe for `scripts/check-erasure-manifest.mjs`.
 *
 * Not compiled, not linted, not shipped: `scripts/**` is outside both tsconfig
 * programs and eslint's scope, and `scripts/fixtures/**` is in knip's ignore
 * list. The gate reads schema files as TEXT, so nothing here has to resolve an
 * import.
 *
 * Three PII-heuristic columns, deliberately answered three different ways by
 * the sibling probe files, so a fixture run exercises both arms of the coverage
 * check rather than only the failing one:
 *   - `email`       -> a manifest rule
 *   - `client_name` -> a manifest rule that needs a legalBasis
 *   - `ip_address`  -> an ERASURE_OUT_OF_SCOPE entry
 *
 * `probe_reference_table` is the negative control: no column here matches the
 * PII heuristic, so the gate must stay silent about it. Without that control a
 * green fixture run would be indistinguishable from a gate that stopped looking.
 */
export const probeContacts = sqliteTable('probe_contacts', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    clientName: text('client_name'),
    ipAddress: text('ip_address'),
});

export const probeReferenceTable = sqliteTable('probe_reference_table', {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
