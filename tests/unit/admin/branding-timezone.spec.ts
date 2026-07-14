import { describe, it, expect } from 'vitest';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin/settings';

describe('branding tz validation', () => {
  it('accepts a valid IANA timezone', () => {
    expect(UpdateBrandingSchema.safeParse({ defaultTimezone: 'America/New_York' }).success).toBe(true);
  });
  it('rejects a non-IANA timezone', () => {
    expect(UpdateBrandingSchema.safeParse({ defaultTimezone: 'garbage/zone' }).success).toBe(false);
  });
});
