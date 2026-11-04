/**
 * The money-bearing reads, as the company owner and as an inspector whose inspection-fees capability is off.
 *
 * The conformance pass in response-conformance.spec.ts requests everything as the owner only, so it cannot see what a caller without
 * the capability receives. This second pass requests the reads that carry money (the inspection, its report data, the inspection list
 * and the cost items) as that inspector, compares each body with the response schema, and asserts that no key the money naming rule
 * matches (`*Cents`, price, discountAmount, priceOverride, priceSnapshot) is present. The owner pass is the control: the same reads
 * do carry money keys there, so an empty result for the inspector is the capability at work and not a fixture without money.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MONEY_READS, observeMoneyReads, opKey, type MoneyObservation } from '../helpers/response-conformance';

let owner: MoneyObservation[] = [];
let inspector: MoneyObservation[] = [];
beforeAll(async () => {
    owner = await observeMoneyReads('owner');
    inspector = await observeMoneyReads('inspector-without-fees');
}, 120_000);

const name = (o: MoneyObservation): string => opKey(o.method, o.path);

describe('money-bearing reads by capability', () => {
    it('answers every read with 200 and a body that fits its schema, for both callers', () => {
        for (const pass of [owner, inspector]) {
            expect(pass.map(name)).toEqual(MONEY_READS.map((p) => opKey('get', p)));
            for (const o of pass) {
                expect(o.status, name(o)).toBe(200);
                expect(o.bodyKeys, name(o)).toBeGreaterThan(0);
                expect(o.missingRequired, name(o)).toEqual([]);
                expect(o.typeMismatch, name(o)).toEqual([]);
            }
        }
    });

    // What each read carries for the owner, by name. The inspector assertions are only meaningful for a read whose owner response carries
    // money, so each one is named here and checked before the inspector is: an empty owner list would make the inspector check vacuous.
    const OWNER_KEYS: Record<string, string[]> = {
        '/api/inspections/{id}': ['depositRequiredCents', 'discountAmount', 'price'],
        '/api/inspections/{id}/report-data': ['depositRequiredCents', 'discountAmount'],
    };

    it.each(Object.entries(OWNER_KEYS))('control: the owner response of %s carries its money keys', (route, keys) => {
        const read = owner.find((o) => o.path === route)!;
        expect(read.moneyKeys.length, route).toBeGreaterThan(0);
        expect(read.moneyKeys, route).toEqual(keys);
    });

    it('an inspector without the fees capability receives none of those keys on the two reads whose owner response carries them', () => {
        for (const route of Object.keys(OWNER_KEYS)) {
            expect(owner.find((o) => o.path === route)!.moneyKeys.length, `${route} owner control`).toBeGreaterThan(0);
            expect(inspector.find((o) => o.path === route)!.moneyKeys, route).toEqual([]);
        }
    });

    it('the inspection list carries no money key for the owner or the inspector: its rows are a projection without prices', () => {
        // Recorded as a fact rather than checked as redaction: there is nothing to redact, so this guards against a price column joining the list.
        expect(owner.find((o) => o.path === '/api/inspections')!.moneyKeys).toEqual([]);
        expect(inspector.find((o) => o.path === '/api/inspections')!.moneyKeys).toEqual([]);
    });

    it('the cost items carry only the repair-estimate figures, which docs/reference/roles.md keeps visible by design, for both callers', () => {
        // Repair estimates belong to the client's repair request, not to company revenue; every revenue key stays out.
        for (const pass of [owner, inspector]) {
            const costs = pass.find((o) => o.path.endsWith('/cost-items'))!;
            expect(costs.moneyKeys).toEqual(['lumpSumCents', 'unitCostCents']);
        }
    });
});
