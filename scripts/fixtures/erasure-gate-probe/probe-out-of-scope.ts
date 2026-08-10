/**
 * FIXTURE — the out-of-scope half of the erasure probe. Shared by every
 * `probe-manifest*.ts` variant in this directory, because the variants differ
 * only in how the MANIFEST array is declared.
 */
export const ERASURE_OUT_OF_SCOPE: ErasureOutOfScopeEntry[] = [
    {
        table: 'probe_contacts',
        column: 'ip_address',
        reason: 'fixture: the reasoned-exclusion arm of the coverage check, so a green probe run proves both arms and not just the manifest one',
    },
];
