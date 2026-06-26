/**
 * Email provider resolution — maps a stored `email_byo_provider` value to
 * the matching EmailProvider adapter instance. The resolver is a pure selection
 * function: it does NOT do I/O; callers supply the already-decrypted creds.
 *
 * Currently supports:
 *   - 'resend'  (default/null)     → ResendProvider
 *   - 'sendgrid'                   → SendgridProvider
 *   - 'postmark'                   → PostmarkProvider
 *   - 'mailgun'                    → MailgunProvider
 */
import type { EmailProvider } from './provider';
import { ResendProvider } from './providers/resend';
import { SendgridProvider } from './providers/sendgrid';
import { PostmarkProvider } from './providers/postmark';
import { MailgunProvider } from './providers/mailgun';

/** The selectable BYO email providers, in one place so callers can validate
 *  an untrusted value (e.g. a raw DB read) against the allow-list before use. */
export const EMAIL_BYO_PROVIDERS = ['resend', 'sendgrid', 'postmark', 'mailgun'] as const;
export type EmailByoProvider = (typeof EMAIL_BYO_PROVIDERS)[number];

/** Narrow an untrusted value to a known provider, defaulting to 'resend'. */
export function coerceEmailByoProvider(value: unknown): EmailByoProvider {
  return (EMAIL_BYO_PROVIDERS as ReadonlyArray<string>).includes(value as string)
    ? (value as EmailByoProvider)
    : 'resend';
}

/**
 * Union of credential shapes accepted by the four providers.
 * All four take `{ apiKey: string }`; Mailgun additionally requires `domain`.
 */
export type EmailProviderCreds =
  | { apiKey: string }
  | { apiKey: string; domain: string };

/**
 * Return an EmailProvider for the given `byoProvider` value + their creds.
 * `null | undefined | 'resend'` → ResendProvider (existing behavior, unchanged).
 * 'sendgrid'                    → SendgridProvider
 * 'postmark'                    → PostmarkProvider (creds.apiKey carries the POSTMARK_SERVER_TOKEN value)
 * 'mailgun'                     → MailgunProvider (creds must include { apiKey, domain })
 */
export function resolveEmailProvider(
  byoProvider: EmailByoProvider | null | undefined,
  creds: EmailProviderCreds,
): EmailProvider {
  switch (byoProvider) {
    case 'sendgrid':
      return new SendgridProvider(creds as { apiKey: string });
    case 'postmark':
      return new PostmarkProvider(creds as { apiKey: string });
    case 'mailgun':
      return new MailgunProvider(creds as { apiKey: string; domain: string });
    default:
      // null | undefined | 'resend' — unchanged behavior
      return new ResendProvider(creds as { apiKey: string });
  }
}
