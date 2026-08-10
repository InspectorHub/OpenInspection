/**
 * FIXTURE — the rule array is present, correctly named, exported and
 * parseable, and holds nothing.
 *
 * "Found nothing" and "looked at nothing" produce the same empty list, and
 * every other rule in the gate reports on what was parsed. The out-of-scope and
 * open arrays are kept populated on purpose: the zero guard under test is the
 * one on the RULES, and leaving the other two intact stops the run from going
 * red for the unrelated reason that a ledger table lost its answer.
 */
export const RETENTION_MANIFEST: RetentionRule[] = [];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'gate_probe_log',
        reason: 'fixture: keeps the ledger-coverage check satisfied so the only complaint left is the zero guard',
    },
    {
        table: 'probe_cmd_events',
        reason: 'fixture: keeps the ledger-coverage check satisfied so the only complaint left is the zero guard',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
