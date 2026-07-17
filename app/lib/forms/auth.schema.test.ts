import { describe, it, expect, afterEach } from 'vitest';
import { makeForgotPasswordSchema, makeResetPasswordSchema, makePasswordHint, makeLoginSchema } from './auth.schema';
import { overwriteGetLocale } from '~/paraglide/runtime';
import { m } from '~/paraglide/messages';

describe('makeForgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(makeForgotPasswordSchema().parse({ email: 'a@b.com' }).email).toBe('a@b.com');
  });
  it('rejects an empty email', () => {
    expect(makeForgotPasswordSchema().safeParse({ email: '' }).success).toBe(false);
  });
  it('rejects a malformed email', () => {
    expect(makeForgotPasswordSchema().safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('makeResetPasswordSchema', () => {
  it('accepts a strong password', () => {
    expect(makeResetPasswordSchema().parse({ newPassword: 'ValidPass1!' }).newPassword).toBe('ValidPass1!');
  });
  it('rejects fewer than 8 chars', () => {
    expect(makeResetPasswordSchema().safeParse({ newPassword: 'Va1!' }).success).toBe(false);
  });
  it('rejects a password with no uppercase', () => {
    expect(makeResetPasswordSchema().safeParse({ newPassword: 'validpass1!' }).success).toBe(false);
  });
  it('rejects a password with no number', () => {
    expect(makeResetPasswordSchema().safeParse({ newPassword: 'ValidPass!' }).success).toBe(false);
  });
  it('rejects a password with no special char', () => {
    expect(makeResetPasswordSchema().safeParse({ newPassword: 'ValidPass1' }).success).toBe(false);
  });
});

describe('makePasswordHint', () => {
  it('states the strong-password requirements', () => {
    expect(makePasswordHint()).toBe(
      'At least 8 characters, with an uppercase letter, a number, and a special character.',
    );
  });
});

/**
 * i18n Phase C — auth/login pilot. Proves the three localization paths the pilot
 * exercises resolve against the active paraglide locale: (1) client JSX messages,
 * (2) server action + interpolation messages, (3) Zod validation via the
 * locale-aware schema factory. `overwriteGetLocale` stands in for the request's
 * ALS/cookie-resolved locale.
 */
describe('auth login i18n (Phase C pilot)', () => {
  afterEach(() => overwriteGetLocale(() => 'en'));

  it('resolves login UI messages in en (baseLocale)', () => {
    overwriteGetLocale(() => 'en');
    expect(m.auth_login_heading()).toBe('Log in to your workspace');
    expect(m.auth_login_submit()).toBe('Log In');
    expect(m.auth_login_email_label()).toBe('Email address');
  });

  it('resolves login UI + interpolation messages in es-419', () => {
    overwriteGetLocale(() => 'es-419');
    expect(m.auth_login_heading()).toBe('Inicia sesión en tu espacio de trabajo');
    expect(m.auth_login_submit()).toBe('Iniciar sesión');
    // category 2 — server-side interpolation message
    expect(m.auth_login_error_failed_with_status({ status: 500 })).toBe(
      'Error al iniciar sesión (500)',
    );
  });

  it('makeLoginSchema yields locale-aware validation messages (category 3)', () => {
    overwriteGetLocale(() => 'es-419');
    const es = makeLoginSchema().safeParse({ email: '', password: '' });
    const esMsgs = es.success ? [] : es.error.issues.map((i) => i.message);
    expect(esMsgs).toContain('El correo electrónico es obligatorio');
    expect(esMsgs).toContain('La contraseña es obligatoria');

    overwriteGetLocale(() => 'en');
    const en = makeLoginSchema().safeParse({ email: '', password: '' });
    const enMsgs = en.success ? [] : en.error.issues.map((i) => i.message);
    expect(enMsgs).toContain('Email is required');
    expect(enMsgs).toContain('Password is required');
  });
});
