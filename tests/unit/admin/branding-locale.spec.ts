import { describe, it, expect } from 'vitest';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin/settings';

describe('branding locale/currency validation', () => {
  it('accepts a supported locale + currency', () => {
    expect(UpdateBrandingSchema.safeParse({ defaultLocale: 'es-419', currency: 'USD' }).success).toBe(true);
    expect(UpdateBrandingSchema.safeParse({ defaultLocale: 'en-US' }).success).toBe(true);
  });
  it('rejects a malformed locale tag', () => {
    expect(UpdateBrandingSchema.safeParse({ defaultLocale: '!!' }).success).toBe(false);
  });
  it('rejects an unsupported currency', () => {
    expect(UpdateBrandingSchema.safeParse({ currency: 'EUR' }).success).toBe(false);
  });
});
