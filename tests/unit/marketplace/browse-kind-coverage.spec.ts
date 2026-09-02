/**
 * Every kind a catalogue row can carry must be one a person can filter for.
 *
 * The browse filter's enum was typed by hand as ['comments', 'templates'] while
 * the column's own enum said ['comments', 'templates', 'statutory']. The two
 * disagreed in both directions at once: it offered `templates`, which no row in
 * the shipped catalogue carries, and refused `statutory`, which five of them do.
 *
 * Nothing failed. The service layer (`catalogue-browse.ts`) accepted all three
 * the whole time, so the rows were still returned under "All" — they were
 * simply unreachable by the control a person would use to find them. That is
 * the shape this file exists to catch: not an error, an absence.
 *
 * ⚠️ `lint:marketplace-kind-halves` does not cover it, and saying so is the
 * point. That gate asks whether each kind has an import path and an un-import
 * path — whether the round trip works once you have found the thing. Whether
 * you can find it is a different question, and no instrument was asking it.
 */
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { marketplaceLibraries, MARKETPLACE_KINDS } from '../../../server/lib/db/schema';
import { MarketplaceBrowseQuerySchema } from '../../../server/lib/validations/marketplace-browse.schema';

/** The kinds the DATABASE COLUMN admits — the authority, read off the table. */
const columnKinds = (): readonly string[] => {
    const col = getTableConfig(marketplaceLibraries).columns.find((c) => c.name === 'kind');
    return (col as unknown as { enumValues?: readonly string[] }).enumValues ?? [];
};

describe('marketplace browse — the filter can name every kind that exists', () => {
    it('CONTROL — the column really declares an enum, and it is not empty', () => {
        // Without this, "the filter covers every column kind" is satisfied by a
        // column that declares none, and this file would pass while measuring
        // nothing at all.
        expect(columnKinds().length).toBeGreaterThan(1);
    });

    it('the exported list IS the column enum, not a copy that agrees today', () => {
        expect([...MARKETPLACE_KINDS].sort()).toEqual([...columnKinds()].sort());
    });

    it('accepts every kind the column admits', () => {
        for (const kind of columnKinds()) {
            const parsed = MarketplaceBrowseQuerySchema.safeParse({ kind });
            expect(parsed.success, `browse refuses kind=${kind}`).toBe(true);
        }
    });

    it('NEGATIVE CONTROL — and still refuses a kind no row can carry', () => {
        // The assertion above is satisfiable by a filter that accepts anything.
        expect(MarketplaceBrowseQuerySchema.safeParse({ kind: 'invoices' }).success).toBe(false);
    });

    it('omitting the filter is valid, because "All" is a real answer', () => {
        expect(MarketplaceBrowseQuerySchema.safeParse({}).success).toBe(true);
    });
});
