/**
 * FIXTURE — the input that proves `scripts/check-retention-manifest.mjs` bites.
 *
 * Not compiled, not linted, not shipped: `scripts/**` is outside both tsconfig
 * programs and eslint's scope, and this directory is in knip's ignore list. The
 * gate reads schema files as TEXT, so this file never has to resolve an import.
 *
 * Run:
 *   node scripts/check-retention-manifest.mjs --schema-dir scripts/fixtures/retention-gate-probe
 *
 * Expected: exit 1, naming `gate_probe_log` and `probe_cmd_events`. That is the
 * assertion that matters — the erasure manifest carried a structural blind spot
 * for months precisely because nothing forced a NEW table into it, and a
 * retention catalogue nothing forces new tables into decays the same way.
 *
 * `probe_reference_table` is here as the negative control: it is not
 * ledger-shaped and must NOT be reported, or the gate is just failing on
 * everything and the positive result means nothing.
 */
export const gateProbeLog = sqliteTable('gate_probe_log', {
    id: text('id').primaryKey(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
});

export const probeCmdEvents = sqliteTable('probe_cmd_events', {
    eventId: text('event_id').primaryKey(),
    // Deliberately NOT created_at/received_at: the retired column heuristic was
    // blind to exactly this shape, and the name pattern is not.
    handledAt: integer('handled_at', { mode: 'timestamp_ms' }).notNull(),
});

export const probeReferenceTable = sqliteTable('probe_reference_table', {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
