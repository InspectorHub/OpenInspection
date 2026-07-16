import { describe, it, expect } from 'vitest';
import { PatchProfileSchema } from '../../../server/api/profile';

describe('profile locale validation', () => {
  it('accepts a supported BCP-47 locale', () => {
    expect(PatchProfileSchema.safeParse({ locale: 'es-419' }).success).toBe(true);
  });
  it('accepts empty string (clears the override -> inherit tenant)', () => {
    expect(PatchProfileSchema.safeParse({ locale: '' }).success).toBe(true);
  });
  it('rejects a malformed locale tag', () => {
    expect(PatchProfileSchema.safeParse({ locale: '!!' }).success).toBe(false);
  });
});
