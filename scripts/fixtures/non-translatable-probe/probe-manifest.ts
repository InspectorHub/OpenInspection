/**
 * Probe manifest for `scripts/check-non-translatable.mjs --fixture`.
 *
 * Every entry below except the two marked OK is a violation the gate must name.
 * Kept out of tracked server source deliberately: a probe that mutates the real
 * registry and relies on being reverted is one interrupted run away from being
 * committed (same reasoning as `scripts/fixtures/retention-gate-probe`).
 *
 * The category tuple here is the CORRECT list. Disagreement between the source
 * list and the gate's own copy is proven by breaking the real file, not here —
 * keeping it correct in the probe is what lets the other failures be read.
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
    'legal_notice',
    'consent_waiver',
    'statutory_certification',
] as const;

export const NON_TRANSLATABLE_MANIFEST = [
    // OK — positive control. Valid category, existing source, present locator,
    // no catalogue import, non-empty reason.
    {
        id: 'probe-ok-signature',
        category: 'signature',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_SIGNATURE_BLOCK',
        reason: 'positive control: a well-formed entry the gate must leave alone',
    },
    // OK — second positive control, different category.
    {
        id: 'probe-ok-reliance',
        category: 'reliance_clause',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_RELIANCE',
        reason: 'positive control: a second well-formed entry',
    },
    // VIOLATION — empty reason.
    {
        id: 'probe-empty-reason',
        category: 'limitation_of_liability',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_LIABILITY',
        reason: '',
    },
    // VIOLATION — no locator field at all.
    {
        id: 'probe-no-locator',
        category: 'warranty_disclaimer',
        source: 'probe-clean-source.ts',
        reason: 'an entry that names a file but nothing inside it',
    },
    // VIOLATION — category outside the eight.
    {
        id: 'probe-bad-category',
        category: 'shipping_terms',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_SIGNATURE_BLOCK',
        reason: 'a category outside the closed set of eight',
    },
    // VIOLATION — source path does not exist.
    {
        id: 'probe-vanished-source',
        category: 'governing_law',
        source: 'probe-file-that-was-moved.ts',
        locator: 'PROBE_GOVERNING_LAW',
        reason: 'the file this entry names has been moved away',
    },
    // VIOLATION — locator no longer occurs in an existing source.
    {
        id: 'probe-stale-locator',
        category: 'contract_terms',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_RENAMED_AWAY',
        reason: 'the constant this entry names was renamed',
    },
    // VIOLATION — instrument text rendered through the message catalogue.
    {
        id: 'probe-catalogue-rendered',
        category: 'acknowledgement',
        source: 'probe-translated-source.ts',
        locator: 'PROBE_ACKNOWLEDGEMENT',
        reason: 'an acknowledgement wired into paraglide',
    },
    // VIOLATION — duplicate id.
    {
        id: 'probe-ok-signature',
        category: 'signature',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_SIGNATURE_BLOCK',
        reason: 'a second entry reusing an id that is already taken',
    },
    // VIOLATION — id also present in the out-of-scope register.
    {
        id: 'probe-shared-id',
        category: 'limitation_of_liability',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_LIABILITY',
        reason: 'this id is claimed by both registers',
    },
    // OK — the three categories added when the classification was completed.
    // They are APPENDED so the `manifest #N` positions the spec asserts on stay
    // put; an inserted entry renumbers every assertion after it.
    {
        id: 'probe-ok-legal-notice',
        category: 'legal_notice',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_LIABILITY',
        reason: 'positive control: a notice whose wording is the operative act',
    },
    {
        id: 'probe-ok-consent-waiver',
        category: 'consent_waiver',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_RELIANCE',
        reason: 'positive control: a waiver gives something up, unlike an acknowledgement',
    },
    {
        id: 'probe-ok-statutory-certification',
        category: 'statutory_certification',
        source: 'probe-clean-source.ts',
        locator: 'PROBE_SIGNATURE_BLOCK',
        reason: 'positive control: prescribed form language reproduced, not composed',
    },
    // NOTE: no `arbitration` entry anywhere above. That omission is the
    // coverage violation — a register missing one category reads as complete.
];
