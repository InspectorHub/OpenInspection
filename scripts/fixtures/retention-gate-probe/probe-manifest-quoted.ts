/**
 * FIXTURE — the anti-vacuous pair for `probe-manifest-renamed.ts`.
 *
 * The array below is correctly named and complete. This doc comment quotes the
 * declaration anyway — `export const RETENTION_MANIFEST: RetentionRule[] = []`
 * — exactly as the renamed variant does.
 *
 * So the gate must exit 0 here. A parser "fixed" by refusing to parse any file
 * that mentions its own array name would pass the renamed test and fail this
 * one. The anchor is what tells the two apart: prose about a declaration is
 * indented, and a declaration is not.
 */
export const RETENTION_MANIFEST: RetentionRule[] = [
    {
        table: 'gate_probe_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: a well-formed rule the gate must still find with prose quoting its declaration above it',
    },
];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'probe_cmd_events',
        reason: 'fixture: unchanged from the clean variant, so the only difference under test is the doc comment',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
