// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { makeForgotPasswordSchema, makeResetPasswordSchema, makePasswordHint, makeLoginSchema, makeAgentSignupSchema } from './auth.schema';
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

/**
 * The agent-terms tick is the only thing standing between an OAuth visitor and
 * an account created with no recorded acceptance, and nothing pinned it.
 *
 * The path that makes this load-bearing: a Google sign-in whose email has no
 * agent account is not an error — portal bounces it to `/agent-signup?email=…`
 * with the address pre-filled. So the busiest way into this form arrives with
 * one field already answered and momentum behind it. The server refuses without
 * an acceptance too (`server/services/agent/signup.ts`), and that is the real
 * guard; this is the one the person actually meets.
 *
 * `signup.tsx`'s action sends `termsAccepted: true` as a literal, and it is
 * right to — reaching the action means `parseWithZod` already passed. That is
 * exactly why the schema needs its own test: delete the refine and the hardcoded
 * `true` becomes a lie that nothing else in the suite contradicts.
 */
describe('makeAgentSignupSchema — the tick', () => {
  const VALID = {
    name: 'Dana Agent',
    email: 'dana@example.com',
    password: 'CorrectHorse123!Battery',
    agentTerms: 'on',
  };

  // What a browser actually posts with the box unticked: the field is ABSENT,
  // not empty. Written out rather than derived by subtracting a key from VALID
  // — the shape under test should be readable without running the subtraction.
  const WITHOUT_TICK = { name: VALID.name, email: VALID.email, password: VALID.password };

  // The positive control. Without it, a schema that rejected EVERYTHING would
  // satisfy every other assertion here.
  it('accepts a submission with the box ticked', () => {
    expect(makeAgentSignupSchema().safeParse(VALID).success).toBe(true);
  });

  it('rejects a submission with the box UNTICKED — an absent field, which is what a browser sends', () => {
    expect(makeAgentSignupSchema().safeParse(WITHOUT_TICK).success).toBe(false);
  });

  it('rejects a value that is present but is not the tick', () => {
    // A hand-crafted POST, or a checkbox given a `value` other than the default.
    expect(makeAgentSignupSchema().safeParse({ ...VALID, agentTerms: 'off' }).success).toBe(false);
    expect(makeAgentSignupSchema().safeParse({ ...VALID, agentTerms: 'true' }).success).toBe(false);
    expect(makeAgentSignupSchema().safeParse({ ...VALID, agentTerms: '' }).success).toBe(false);
  });

  // The refusal has to be attributable, or a form shows "something is wrong"
  // beside the wrong field. Both shapes above must name THIS field.
  it('attributes the failure to agentTerms in both the absent and the wrong-value case', () => {
    for (const input of [WITHOUT_TICK, { ...VALID, agentTerms: 'off' }]) {
      const res = makeAgentSignupSchema().safeParse(input);
      expect(res.success).toBe(false);
      if (res.success) continue;
      expect(res.error.issues.some(i => i.path[0] === 'agentTerms')).toBe(true);
    }
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
    // Formal `usted` register — see docs/develop/conventions/i18n-glossary.md.
    expect(m.auth_login_heading()).toBe('Inicie sesión en su espacio de trabajo');
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
