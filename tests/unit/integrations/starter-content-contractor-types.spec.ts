import { describe, it, expect } from 'vitest';
import { CONTRACTOR_TYPES } from '../../../server/services/starter-content/fixtures/contractor-types';
import { DEFECT_TRADES, DEFECT_TRADE_LABELS } from '../../../server/types/defect-fields';

/**
 * The contractor-type seed, now DERIVED from the trade vocabulary (#277).
 *
 * The list it replaced was ten hand-written names carrying a comment that they
 * *"MUST stay in sync with the contractor-type backfill in 0000_baseline.sql"* —
 * a backfill that no longer exists. The coupling is executable now, and this is
 * where it is executed.
 *
 * ⚠️ THE ASSERTIONS ARE SPLIT BY ROW KIND, and that is not tidiness. The plan
 * this came from specified two tests that cannot both pass: one asserting the
 * seeded slug set EQUALS `DEFECT_TRADES`, another asserting a tenant-only type
 * exists with a NULL slug. Seed the extras and the first test's set contains
 * `null`; omit them and the second reads `undefined`. The extras win — they are
 * real data existing tenants use — so the canonical assertion filters NULLs.
 */
describe('contractor-type seed', () => {
    const canonical = CONTRACTOR_TYPES.filter((c) => c.tradeSlug !== null);
    const extras = CONTRACTOR_TYPES.filter((c) => c.tradeSlug === null);

    it('covers every canonical trade exactly once', () => {
        // The executable half of the old "must stay in sync" comment. A trade
        // added to the vocabulary with no seeded contractor type would leave a
        // defect taggable with a trade no workspace can act on.
        expect(canonical.map((c) => c.tradeSlug).sort())
            .toEqual([...DEFECT_TRADES].sort());
        expect(canonical).toHaveLength(DEFECT_TRADES.length);
    });

    it('keeps the tenant-only types, with a NULL slug', () => {
        // NULL is permanent here, not a backfill gap. Deleting these would drop
        // data existing tenants already use.
        expect(extras.map((e) => e.name)).toEqual(['Foundation Specialist', 'Grading/Drainage']);
    });

    it('does not mangle an acronym while title-casing', () => {
        // `DEFECT_TRADE_LABELS` is lower case because it renders mid-sentence.
        // A naive capitalise turns "HVAC technician" into "Hvac Technician",
        // which is wrong in a way that survives review because it looks
        // deliberate.
        expect(DEFECT_TRADE_LABELS['hvac-technician']).toBe('HVAC technician');
        const hvac = CONTRACTOR_TYPES.find((c) => c.tradeSlug === 'hvac-technician');
        expect(hvac?.name).toBe('HVAC Technician');
    });

    it('preserves hyphenated labels', () => {
        expect(CONTRACTOR_TYPES.find((c) => c.tradeSlug === 'mold-remediation-specialist')?.name)
            .toBe('Mold-remediation Specialist');
    });

    it('numbers sortOrder contiguously from 1, vocabulary order first', () => {
        // The dropdown order must match the order the defect trade picker
        // offers, not alphabetical — nobody reaches for "Appliance Technician"
        // before "General Contractor".
        expect(CONTRACTOR_TYPES.map((c) => c.sortOrder))
            .toEqual(CONTRACTOR_TYPES.map((_, i) => i + 1));
        expect(CONTRACTOR_TYPES[0]?.tradeSlug).toBe(DEFECT_TRADES[0]);
    });

    it('has no duplicate names', () => {
        // There is NO unique index on contractor_types, so a duplicate name here
        // would be inserted silently and show up twice in every dropdown.
        const names = CONTRACTOR_TYPES.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
