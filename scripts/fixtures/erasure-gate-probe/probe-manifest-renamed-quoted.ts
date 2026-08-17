/**
 * FIXTURE — defect 2: the catalogue is renamed away AND this doc comment quotes
 * the declaration it used to have. The scaffold shipped
 * `export const ERASURE_MANIFEST: ErasureRule[] = []` and was filled in later.
 *
 * That sentence is the whole fixture. It is the kind of line real doc comments
 * contain, and to an unanchored search it is indistinguishable from the thing
 * it describes.
 *
 * Why this file exists SEPARATELY from `probe-manifest-renamed.ts`: the two
 * defects mask each other. Add the lookahead alone and this input stops
 * reporting OK — it starts reporting "parsed ZERO rules" instead, because the
 * parser now walks past the `_V2` declaration, lands mid-sentence, finds the
 * `= []` inside the quotation and reads it as an empty catalogue. That is not a
 * fix; it is a second wrong answer, and a worse one to debug, because it
 * accuses the catalogue of being empty while 56 rules sit intact in the real
 * file. Only the `^` anchor produces the true answer: the array is missing.
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
