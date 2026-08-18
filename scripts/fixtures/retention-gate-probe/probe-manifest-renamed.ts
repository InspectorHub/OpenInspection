/**
 * FIXTURE — defect 1 on its own: the catalogue has been RENAMED to a name that
 * still begins with the one the gate looks for, and NOTHING in this file quotes
 * the old declaration. That absence is deliberate; the doc-comment defect lives
 * in `probe-manifest-renamed-quoted.ts`, and mixing the two would let either
 * one alone appear to be caught.
 *
 * This is the coarsest sabotage there is. Every consumer of the catalogue is
 * now broken, and a gate located by prefix search reported
 * "OK (1 rules, 1 out-of-scope, 0 open)" — a clean bill of health for a
 * catalogue that no longer exists under the name it is checked by.
 *
 * The trailing negative lookahead is what refuses it: a search for the
 * catalogue must not be satisfied by a longer name that merely starts the same
 * way. The gate must say "could not locate", because it could not.
 */
export const RETENTION_MANIFEST_V2: RetentionRule[] = [
    {
        table: 'gate_probe_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: a well-formed rule, in an array the gate must refuse to find',
        legalHold: 'not_applicable',
        legalHoldNote: 'fixture: no tenant dimension in the probe schema, so a hold cannot be expressed here — the note is required, and this is what a required note looks like',
    },
];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'probe_cmd_events',
        reason: 'fixture: unchanged from the clean variant, so the only difference under test is the manifest declaration',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
