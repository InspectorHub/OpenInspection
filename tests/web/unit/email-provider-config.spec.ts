import { describe, it, expect } from 'vitest';
import { ownEmailProviderConfigured, type EmailProviderSecrets } from '~/lib/email-provider-config';

/**
 * The Email delivery panel's own-mode guardrail + status copy keys off whether
 * the SELECTED provider's credentials are present. The Settings loader receives
 * masked secrets where "" = not configured, so this maps a provider + that
 * masked map to a boolean. Mailgun is the only provider needing two values.
 */
const none: EmailProviderSecrets = {
  RESEND_API_KEY: '',
  SENDGRID_API_KEY: '',
  POSTMARK_SERVER_TOKEN: '',
  MAILGUN_API_KEY: '',
  MAILGUN_DOMAIN: '',
};
// A masked value is any non-empty string.
const M = '••••1234';

describe('ownEmailProviderConfigured', () => {
  it('resend → keys off RESEND_API_KEY only', () => {
    expect(ownEmailProviderConfigured('resend', none)).toBe(false);
    expect(ownEmailProviderConfigured('resend', { ...none, RESEND_API_KEY: M })).toBe(true);
    // a non-resend key set does not make resend configured
    expect(ownEmailProviderConfigured('resend', { ...none, SENDGRID_API_KEY: M })).toBe(false);
  });

  it('sendgrid → keys off SENDGRID_API_KEY only', () => {
    expect(ownEmailProviderConfigured('sendgrid', none)).toBe(false);
    expect(ownEmailProviderConfigured('sendgrid', { ...none, SENDGRID_API_KEY: M })).toBe(true);
    expect(ownEmailProviderConfigured('sendgrid', { ...none, RESEND_API_KEY: M })).toBe(false);
  });

  it('postmark → keys off POSTMARK_SERVER_TOKEN only', () => {
    expect(ownEmailProviderConfigured('postmark', none)).toBe(false);
    expect(ownEmailProviderConfigured('postmark', { ...none, POSTMARK_SERVER_TOKEN: M })).toBe(true);
  });

  it('mailgun → requires BOTH key and domain', () => {
    expect(ownEmailProviderConfigured('mailgun', none)).toBe(false);
    expect(ownEmailProviderConfigured('mailgun', { ...none, MAILGUN_API_KEY: M })).toBe(false);
    expect(ownEmailProviderConfigured('mailgun', { ...none, MAILGUN_DOMAIN: M })).toBe(false);
    expect(ownEmailProviderConfigured('mailgun', { ...none, MAILGUN_API_KEY: M, MAILGUN_DOMAIN: M })).toBe(true);
  });
});
