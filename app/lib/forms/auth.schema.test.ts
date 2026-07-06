import { describe, it, expect } from 'vitest';
import { forgotPasswordSchema, resetPasswordSchema, PASSWORD_HINT } from './auth.schema';

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.parse({ email: 'a@b.com' }).email).toBe('a@b.com');
  });
  it('rejects an empty email', () => {
    expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false);
  });
  it('rejects a malformed email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts a strong password', () => {
    expect(resetPasswordSchema.parse({ newPassword: 'ValidPass1!' }).newPassword).toBe('ValidPass1!');
  });
  it('rejects fewer than 8 chars', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'Va1!' }).success).toBe(false);
  });
  it('rejects a password with no uppercase', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'validpass1!' }).success).toBe(false);
  });
  it('rejects a password with no number', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'ValidPass!' }).success).toBe(false);
  });
  it('rejects a password with no special char', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'ValidPass1' }).success).toBe(false);
  });
});

describe('PASSWORD_HINT', () => {
  it('states the strong-password requirements', () => {
    expect(PASSWORD_HINT).toBe(
      'At least 8 characters, with an uppercase letter, a number, and a special character.',
    );
  });
});
