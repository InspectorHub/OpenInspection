/**
 * The capability lookup is a database read, and a request replayed from an
 * offline package pays for every one it makes (the import budget spec counts
 * them). So the money guard and the money view read the caller's capabilities
 * only when the body or the payload mentions money, and each case here is paired
 * with the one that must still look.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { capabilitiesFor } = vi.hoisted(() => ({ capabilitiesFor: vi.fn(async () => ({ financial: false })) }));
vi.mock('../../../server/lib/middleware/require-capability', () => ({ capabilitiesFor }));

import { guardMoneyWrite, moneyView } from '../../../server/lib/auth/money-access';

const ctx = {} as never;

beforeEach(() => capabilitiesFor.mockClear());

describe('guardMoneyWrite', () => {
    it('does not read capabilities for a body with no money field', async () => {
        await guardMoneyWrite(ctx, { notes: 'x', nested: { a: [1, 2] } }, { notes: 'y' });
        expect(capabilitiesFor).not.toHaveBeenCalled();
    });

    it('does read them, and refuses, when the body sets a money field', async () => {
        await expect(guardMoneyWrite(ctx, { price: 500 }, { price: 450 })).rejects.toThrow(/price/);
        expect(capabilitiesFor).toHaveBeenCalledTimes(1);
    });

    it('does read them for money nested in an array', async () => {
        await expect(guardMoneyWrite(ctx, { serviceSelections: [{ priceOverrideCents: 1 }] }, null)).rejects.toThrow();
        expect(capabilitiesFor).toHaveBeenCalledTimes(1);
    });
});

describe('moneyView', () => {
    it('returns a payload with no money untouched and reads nothing', async () => {
        const payload = { id: 'i1', propertyAddress: 'a', people: [{ name: 'n' }] };
        expect(await moneyView(ctx, payload)).toBe(payload);
        expect(capabilitiesFor).not.toHaveBeenCalled();
    });

    it('reads them and removes the money when the payload has some', async () => {
        const out = await moneyView(ctx, { id: 'i1', price: 450, deposit: { amountCents: 9000 } });
        expect(capabilitiesFor).toHaveBeenCalledTimes(1);
        expect(out).toEqual({ id: 'i1', deposit: {} });
    });
});
