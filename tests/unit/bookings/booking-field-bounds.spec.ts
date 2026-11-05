/**
 * The public booking request is unauthenticated, so every free-text field has a ceiling. Each oversize value is refused and the same request
 * at the ceiling is accepted, so a schema that refuses everything cannot pass.
 */
import { describe, it, expect } from 'vitest';
import { PublicBookingSchema } from '../../../server/lib/validations/booking.schema';

const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const valid = {
    tenant: 'acme', address: '123 Main St, City', clientName: 'Dana Buyer', clientEmail: 'dana@example.test',
    date: tomorrow, timeSlot: 'morning' as const, services: [{ serviceId: 'svc-1' }],
};

describe('PublicBookingSchema ceilings', () => {
    it('accepts a request whose fields sit exactly at their ceilings', () => {
        const atCeiling = {
            ...valid,
            tenant: 't'.repeat(100),
            address: 'a'.repeat(500),
            clientName: 'n'.repeat(200),
            clientEmail: `${'e'.repeat(64)}@${'d'.repeat(63)}.example.test`,
            turnstileToken: 'k'.repeat(2048),
            services: [{ serviceId: 's'.repeat(100) }],
        };
        expect(PublicBookingSchema.safeParse(atCeiling).success).toBe(true);
        expect(PublicBookingSchema.safeParse(valid).success).toBe(true);
    });

    it.each([
        ['tenant', { tenant: 't'.repeat(101) }],
        ['address', { address: 'a'.repeat(501) }],
        ['clientName', { clientName: 'n'.repeat(201) }],
        ['clientEmail', { clientEmail: `${'e'.repeat(250)}@example.test` }],
        ['turnstileToken', { turnstileToken: 'k'.repeat(2049) }],
        ['serviceId', { services: [{ serviceId: 's'.repeat(101) }] }],
    ])('refuses an oversize %s', (_field, over) => {
        expect(PublicBookingSchema.safeParse({ ...valid, ...over }).success).toBe(false);
    });
});
