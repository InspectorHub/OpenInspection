/**
 * FIXTURE — the anti-vacuous pair for `probe-manifest-renamed.ts`.
 *
 * The array below is correctly named and complete. This doc comment quotes the
 * declaration anyway — `export const ERASURE_MANIFEST: ErasureRule[] = []` —
 * exactly as the renamed variant does.
 *
 * So the gate must exit 0 here. A parser "fixed" by refusing to parse any file
 * that mentions its own array name would pass the renamed test and fail this
 * one. The anchor is what tells the two apart: prose about a declaration is
 * indented, and a declaration is not.
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
        action: 'erase_in_place',
        legalBasis: 'art_17_3_e',
    },
];
