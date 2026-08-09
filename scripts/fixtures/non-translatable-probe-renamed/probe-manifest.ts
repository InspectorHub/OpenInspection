/**
 * Probe fixture for `scripts/check-non-translatable.mjs --fixture` — the array
 * has been RENAMED to a name that still starts with the one the gate looks for.
 *
 * This fixture exists because the gate shipped with the hole it now closes.
 * `arrayBody` originally located the declaration with
 * `indexOf('export const NON_TRANSLATABLE_MANIFEST')`, which also matches
 * `NON_TRANSLATABLE_MANIFEST_V2` — so renaming the registry away left the gate
 * happily parsing the renamed copy and reporting OK. It was found by breaking
 * the real file and watching the gate stay green, which is the only way that
 * class of bug is ever found.
 *
 * The sibling gates (`check-erasure-manifest.mjs`,
 * `check-retention-manifest.mjs`) inherit the original `indexOf` shape and the
 * same weakness.
 */
export const NON_TRANSLATABLE_CATEGORIES = [
    'reliance_clause',
    'limitation_of_liability',
    'arbitration',
    'warranty_disclaimer',
    'governing_law',
    'contract_terms',
    'signature',
    'acknowledgement',
] as const;

export const NON_TRANSLATABLE_MANIFEST_V2 = [
    {
        id: 'probe-renamed-away',
        category: 'signature',
        source: 'probe-manifest.ts',
        locator: 'NON_TRANSLATABLE_MANIFEST_V2',
        reason: 'a well-formed entry, in an array the gate must refuse to find',
    },
];
