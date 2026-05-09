import { describe, it, expect } from 'vitest';
import { UpdateBrandingSchema } from '../../src/lib/validations/admin.schema';

describe('UpdateBrandingSchema — Round-2 #10 block-report-policy fields', () => {
    it('accepts blockUnpaid + blockUnsignedAgreement booleans', () => {
        const result = UpdateBrandingSchema.parse({
            blockUnpaid: true,
            blockUnsignedAgreement: false,
        });
        expect(result.blockUnpaid).toBe(true);
        expect(result.blockUnsignedAgreement).toBe(false);
    });

    it('rejects non-boolean values for blockUnpaid', () => {
        expect(() => UpdateBrandingSchema.parse({ blockUnpaid: 'yes' as unknown as boolean })).toThrow();
    });

    it('treats both fields as optional', () => {
        const result = UpdateBrandingSchema.parse({});
        expect(result.blockUnpaid).toBeUndefined();
        expect(result.blockUnsignedAgreement).toBeUndefined();
    });
});
