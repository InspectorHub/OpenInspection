/**
 * FIXTURE — the CLEAN retention catalogue for `probe-schema.ts`.
 *
 * Positive control for every other variant in this directory: with
 * `--manifest scripts/fixtures/retention-gate-probe/probe-manifest.ts
 *  --schema-dir scripts/fixtures/retention-gate-probe` the gate must exit 0.
 * A gate that failed on everything would satisfy each negative assertion in the
 * spec on its own, so this file is what makes those assertions mean something.
 *
 * It answers both ledger-shaped tables in the probe schema — `gate_probe_log`
 * with a rule and `probe_cmd_events` with a reasoned exclusion — and carries no
 * dates anywhere. A fixture with a future `decideBy` in it is a test that turns
 * red on a calendar day nobody chose.
 */
export const RETENTION_MANIFEST: RetentionRule[] = [
    {
        table: 'gate_probe_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: a well-formed rule, so the spec can tell a real complaint from a gate that complains about everything',
    },
];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'probe_cmd_events',
        reason: 'fixture: the reasoned-exclusion arm, so a green run proves both arms and not just the rule one',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
