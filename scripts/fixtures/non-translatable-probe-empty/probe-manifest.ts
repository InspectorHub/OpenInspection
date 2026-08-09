/**
 * Probe fixture for `scripts/check-non-translatable.mjs --fixture` — the
 * SELF-GUARD case: the arrays are present, exported and parseable, and hold
 * nothing.
 *
 * This is its own fixture rather than a case inside the main probe because it
 * is the one failure the gate has to catch BEFORE any other check runs. Every
 * rule below the self-guard reports on what was parsed, so a parser that found
 * nothing would otherwise print a clean bill of health for a registry it failed
 * to read. "Found nothing" and "looked at nothing" produce the same empty list.
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

export const NON_TRANSLATABLE_MANIFEST = [];
