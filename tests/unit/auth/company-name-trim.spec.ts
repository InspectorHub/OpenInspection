import { describe, it, expect } from 'vitest';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin/settings';
import { SetupSchema } from '../../../server/lib/validations/auth.schema';

const setup = (companyName: string) => SetupSchema.safeParse({
    companyName, adminName: 'Alex Admin', email: 'admin@example.test', password: 'P@ssword123',
});

describe('company name is trimmed before it is validated', () => {
    it('branding: whitespace-only is rejected, padded is trimmed, existing limits hold', () => {
        expect(UpdateBrandingSchema.safeParse({ companyName: '   ' }).success).toBe(false);
        expect(UpdateBrandingSchema.safeParse({ companyName: '' }).success).toBe(false);
        const padded = UpdateBrandingSchema.safeParse({ companyName: '  Acme Inspections  ' });
        expect(padded.success && padded.data.companyName).toBe('Acme Inspections');
        expect(UpdateBrandingSchema.safeParse({ companyName: 'x'.repeat(51) }).success).toBe(false);
        expect(UpdateBrandingSchema.safeParse({ companyName: 'x'.repeat(50) }).success).toBe(true);
        expect(UpdateBrandingSchema.safeParse({}).success).toBe(true);
    });

    it('setup: whitespace-only is rejected, padded is trimmed, existing minimum holds', () => {
        expect(setup('    ').success).toBe(false);
        expect(setup('a').success).toBe(false);
        expect(setup(' a ').success).toBe(false);
        const padded = setup('  Acme Inspections ');
        expect(padded.success && padded.data.companyName).toBe('Acme Inspections');
    });
});
