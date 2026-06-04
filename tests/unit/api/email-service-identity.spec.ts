import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import type { EmailIdentityConfig } from '../../../server/lib/email/sender-identity';

const identity: EmailIdentityConfig = {
  mode: 'platform',
  senderEmail: null,
  replyTo: 'team@acme.com',
  senderDisplayName: 'Acme Inspections',
  useInspectorFromName: true,
  siteName: 'Acme',
};

function lastResendBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('EmailService sender identity', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds a "Name <addr>" From and a reply_to from the identity', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', identity);
    await svc.sendEmail(['c@x.com'], 'Hi', '<p>hi</p>', undefined, {
      inspector: { name: 'Jane Doe', email: 'jane@acme.com' },
    });
    const body = lastResendBody(fetchMock);
    expect(body.from).toBe('Jane Doe <reports@acme.com>');
    expect(body.reply_to).toBe('team@acme.com');
  });

  it('omits reply_to and uses a bare From when nothing resolves', async () => {
    const bare: EmailIdentityConfig = {
      mode: 'platform', senderEmail: null, replyTo: null,
      senderDisplayName: null, useInspectorFromName: false, siteName: null,
    };
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', bare);
    await svc.sendEmail(['c@x.com'], 'Hi', '<p>hi</p>');
    const body = lastResendBody(fetchMock);
    expect(body.from).toBe('reports@acme.com');
    expect('reply_to' in body).toBe(false);
  });

  it('skips delivery when no api key', async () => {
    const svc = new EmailService('', 'reports@acme.com', 'Acme', identity);
    await svc.sendEmail(['c@x.com'], 'Hi', '<p>hi</p>');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
