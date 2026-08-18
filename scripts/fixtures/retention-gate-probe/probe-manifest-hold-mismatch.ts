/**
 * FIXTURE — a legal-hold classification that contradicts the schema.
 *
 * Identical to `probe-manifest.ts` except that `probe_tenant_log`, which DOES
 * declare `text('tenant_id')`, claims `legalHold: 'not_applicable'`. That is the
 * quiet version of the failure: the rule parses, every required field is
 * present, the note is there, and the table is silently exempted from a
 * preservation obligation it could have honoured.
 *
 * Retention-only fixture: this variant is not part of the shared parser battery,
 * because the erasure gate has no legal-hold field to disagree with.
 */
export const RETENTION_MANIFEST: RetentionRule[] = [
    {
        table: 'gate_probe_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: a well-formed rule, so the mismatch below is the only complaint',
        legalHold: 'not_applicable',
        legalHoldNote: 'fixture: no tenant dimension in the probe schema, so a hold cannot be expressed here',
    },
    {
        table: 'probe_tenant_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: the mismatch under test — this table has a tenant_id and claims a hold cannot reach it',
        legalHold: 'not_applicable',
        legalHoldNote: 'fixture: a reason that reads plausibly and is contradicted by the schema, which is the point',
    },
];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'probe_cmd_events',
        reason: 'fixture: the reasoned-exclusion arm, unchanged from the clean probe',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
