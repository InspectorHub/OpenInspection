/**
 * FIXTURE — the CLEAN erasure manifest. This is the positive control for every
 * other variant in this directory: with `--manifest probe-manifest.ts` the gate
 * must exit 0. If it does not, a sibling variant exiting 1 proves nothing,
 * because a gate that fails on everything satisfies every negative assertion.
 */
export const ERASURE_MANIFEST: ErasureRule[] = [
    {
        table: 'probe_contacts',
        column: 'email',
        category: 'contact',
        action: 'null',
    },
    {
        table: 'probe_contacts',
        column: 'client_name',
        category: 'contact',
        action: 'anonymize',
        legalBasis: 'art_17_3_e',
    },
];
