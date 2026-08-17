/**
 * FIXTURE — defect 1 on its own: the catalogue has been RENAMED to a name that
 * still begins with the one the gate looks for, and NOTHING in this file quotes
 * the old declaration. That absence is deliberate; the doc-comment defect lives
 * in `probe-manifest-renamed-quoted.ts`, and mixing the two would let either
 * one alone appear to be caught.
 *
 * This is the coarsest sabotage there is. Every consumer of the catalogue is
 * now broken, and a gate located by prefix search reported
 * "OK (2 rules, 1 out-of-scope declarations)" — a clean bill of health for a
 * catalogue that no longer exists under the name it is checked by.
 *
 * The trailing negative lookahead is what refuses it: a search for the
 * catalogue must not be satisfied by a longer name that merely starts the same
 * way. The gate must say "could not locate", because it could not.
 */
export const ERASURE_MANIFEST_V2: ErasureRule[] = [
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
        action: 'erase_in_place',
        legalBasis: 'art_17_3_e',
    },
];
