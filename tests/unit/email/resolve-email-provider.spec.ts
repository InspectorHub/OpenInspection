/**
 * Task 4: resolveEmailProvider + assembleTenantEmailService provider-aware routing.
 *
 * Part A: resolveEmailProvider pure selector — correct adapter instanceof, no network.
 * Part B: assembleTenantEmailService — own+sendgrid path routes to SendGrid URL;
 *         platform/default path still routes to Resend.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolveEmailProvider } from '../../../server/lib/email/resolve-provider';
import { ResendProvider } from '../../../server/lib/email/providers/resend';
import { SendgridProvider } from '../../../server/lib/email/providers/sendgrid';
import { PostmarkProvider } from '../../../server/lib/email/providers/postmark';
import { MailgunProvider } from '../../../server/lib/email/providers/mailgun';
import { assembleTenantEmailService, type LoadedEmailConfig, type EmailServiceEnv } from '../../../server/lib/email/build-email-service';

// ---------------------------------------------------------------------------
// Part A: resolveEmailProvider — instanceof assertions, no network calls
// ---------------------------------------------------------------------------
describe('resolveEmailProvider', () => {
  it('returns ResendProvider for null', () => {
    const p = resolveEmailProvider(null, { apiKey: 're_test' });
    expect(p).toBeInstanceOf(ResendProvider);
  });

  it('returns ResendProvider for undefined', () => {
    const p = resolveEmailProvider(undefined, { apiKey: 're_test' });
    expect(p).toBeInstanceOf(ResendProvider);
  });

  it('returns ResendProvider for "resend"', () => {
    const p = resolveEmailProvider('resend', { apiKey: 're_test' });
    expect(p).toBeInstanceOf(ResendProvider);
  });

  it('returns SendgridProvider for "sendgrid"', () => {
    const p = resolveEmailProvider('sendgrid', { apiKey: 'SG.test' });
    expect(p).toBeInstanceOf(SendgridProvider);
  });

  it('returns PostmarkProvider for "postmark"', () => {
    const p = resolveEmailProvider('postmark', { apiKey: 'pm-token' });
    expect(p).toBeInstanceOf(PostmarkProvider);
  });

  it('returns MailgunProvider for "mailgun"', () => {
    const p = resolveEmailProvider('mailgun', { apiKey: 'key-mg', domain: 'mg.example.com' });
    expect(p).toBeInstanceOf(MailgunProvider);
  });
});

// ---------------------------------------------------------------------------
// Part B: assembleTenantEmailService — provider routing via fetch URL assertion
// ---------------------------------------------------------------------------

const baseEnv: EmailServiceEnv = {
  DB: {} as never,
  TENANT_CACHE: {} as never,
  JWT_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_platform',
  SENDER_EMAIL: 'platform@example.com',
};

afterEach(() => vi.restoreAllMocks());

describe('assembleTenantEmailService — own SendGrid path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
  });

  it('routes sendEmail to api.sendgrid.com when mode=own + emailByoProvider=sendgrid + key present', async () => {
    const cfg: LoadedEmailConfig = {
      emailIdentity: {
        mode: 'own',
        senderEmail: 'hello@company.com',
        replyTo: null,
        senderDisplayName: null,
        pointOfContact: 'company',
        companyName: null,
      },
      emailBrand: undefined,
      dbSecrets: { sendgridApiKey: 'SG.test_key' },
      emailByoProvider: 'sendgrid',
    };

    const svc = assembleTenantEmailService(baseEnv, cfg);
    await svc.sendEmail(['recipient@test.com'], 'Test', '<p>hello</p>');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sendgrid.com');
    expect(calledUrl).not.toContain('resend.com');
  });
});

describe('assembleTenantEmailService — platform/default Resend path unchanged', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 }),
    ));
  });

  it('routes sendEmail to api.resend.com when no own creds (platform default)', async () => {
    const cfg: LoadedEmailConfig = {
      emailIdentity: {
        mode: 'platform',
        senderEmail: null,
        replyTo: null,
        senderDisplayName: null,
        pointOfContact: 'company',
        companyName: null,
      },
      emailBrand: undefined,
      dbSecrets: {},
    };

    const svc = assembleTenantEmailService(baseEnv, cfg);
    await svc.sendEmail(['recipient@test.com'], 'Test', '<p>hello</p>');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('resend.com');
  });
});
