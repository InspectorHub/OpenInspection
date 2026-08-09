/**
 * FIXTURE — defect 2: the catalogue is renamed away AND this doc comment quotes
 * the declaration it used to have. The catalogue this type feeds was declared
 * as `export const RETENTION_MANIFEST: RetentionRule[] = []` and filled later.
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
 * accuses the catalogue of being empty while the real rules sit intact. Only
 * the `^` anchor produces the true answer: the array is missing.
 */
export const RETENTION_MANIFEST_V2: RetentionRule[] = [
    {
        table: 'gate_probe_log',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: 30 },
        action: 'delete',
        purpose: 'fixture: a well-formed rule, in an array the gate must refuse to find',
    },
];

export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    {
        table: 'probe_cmd_events',
        reason: 'fixture: unchanged from the clean variant, so the only difference under test is the manifest declaration',
    },
];

export const RETENTION_OPEN: RetentionOpenEntry[] = [];
