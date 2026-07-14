import { describe, it, expect } from 'vitest';
import { PatchProfileSchema } from '../../../server/api/profile';

describe('profile timezone validation', () => {
  it('accepts a valid IANA timezone', () => {
    expect(PatchProfileSchema.safeParse({ timezone: 'America/Denver' }).success).toBe(true);
  });
  it('accepts empty string (clears the override -> inherit tenant)', () => {
    expect(PatchProfileSchema.safeParse({ timezone: '' }).success).toBe(true);
  });
  it('rejects a non-IANA timezone', () => {
    expect(PatchProfileSchema.safeParse({ timezone: 'garbage/zone' }).success).toBe(false);
  });
});
