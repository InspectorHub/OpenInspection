/**
 * IA-95 — the `financial` capability was enforced correctly but worn by only
 * one of three money-bearing endpoints, and the default inspector has
 * `financial: false`. These pin the single redactor that now covers all of
 * them, including the cases a naive deep-clone gets wrong.
 */
import { describe, it, expect } from 'vitest';
import { redactMoney, isMoneyField } from '../../../server/lib/auth/money-redaction';

const CAN = { financial: true };
const CANNOT = { financial: false };

describe('isMoneyField — the schema rules\' naming convention', () => {
    it('matches the `_cents` convention and the legacy `price` column', () => {
        for (const k of ['priceCents', 'amountCents', 'priceSnapshot' + 'Cents', 'price']) {
            expect(isMoneyField(k)).toBe(true);
        }
    });

    it('does not match fields that merely mention money-ish words', () => {
        for (const k of ['priceLabel', 'currency', 'centsPerUnit', 'amount', 'Price']) {
            expect(isMoneyField(k)).toBe(false);
        }
    });
});

describe('redactMoney', () => {
    it('returns the payload untouched when financial is granted', () => {
        const hub = { inspection: { price: 45000 }, invoice: { amountCents: 45000 } };
        expect(redactMoney(hub, CAN)).toBe(hub); // identity — permitted path costs nothing
    });

    it('drops money at every depth for the hub payload shape', () => {
        const hub = {
            inspection: { id: 'i1', price: 45000, propertyAddress: '1 Main St' },
            services: [
                { id: 's1', name: 'Radon', priceCents: 15000, priceSnapshot: 15000, priceOverride: null },
            ],
            invoice: { id: 'inv1', status: 'sent', amountCents: 45000 },
        };
        const out = redactMoney(hub, CANNOT) as typeof hub;

        expect(out.inspection).not.toHaveProperty('price');
        expect(out.services[0]).not.toHaveProperty('priceCents');
        expect(out.invoice).not.toHaveProperty('amountCents');

        // Everything that is not money survives, at every depth.
        expect(out.inspection.propertyAddress).toBe('1 Main St');
        expect(out.services[0].name).toBe('Radon');
        expect(out.invoice.status).toBe('sent');
    });

    it('deletes the key rather than zeroing it — a 0 is a lie an operator could act on', () => {
        const out = redactMoney({ amountCents: 45000 }, CANNOT);
        expect(Object.prototype.hasOwnProperty.call(out, 'amountCents')).toBe(false);
        expect((out as { amountCents?: number }).amountCents).toBeUndefined();
    });

    it('drops money inside arrays of arrays', () => {
        const out = redactMoney({ groups: [[{ priceCents: 1, name: 'a' }]] }, CANNOT) as
            { groups: Array<Array<{ name: string }>> };
        expect(out.groups[0][0]).not.toHaveProperty('priceCents');
        expect(out.groups[0][0].name).toBe('a');
    });

    it('preserves Date instances — a naive object spread flattens them to {}', () => {
        const when = new Date('2026-07-28T00:00:00.000Z');
        const out = redactMoney({ createdAt: when, priceCents: 1 }, CANNOT) as { createdAt: Date };
        expect(out.createdAt).toBeInstanceOf(Date);
        expect(out.createdAt.getTime()).toBe(when.getTime());
    });

    it('leaves null and primitives alone', () => {
        expect(redactMoney(null, CANNOT)).toBeNull();
        expect(redactMoney({ a: null, b: 0, c: false, priceCents: 9 }, CANNOT))
            .toEqual({ a: null, b: 0, c: false });
    });
});
