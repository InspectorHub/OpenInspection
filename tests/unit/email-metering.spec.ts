import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../server/services/email.service';

describe('EmailService meter hook', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))));
  afterEach(() => vi.unstubAllGlobals());

  it('awaits meter.record once after a successful send', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('re_realkey', 'no-reply@x.io', 'App', undefined, undefined, { record });
    await svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>');
    expect(record).toHaveBeenCalledTimes(1);
  });
  it('does NOT record when the API key is missing', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('your_api_key', 'no-reply@x.io', 'App', undefined, undefined, { record });
    await svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>');
    expect(record).not.toHaveBeenCalled();
  });
  it('does NOT record when Resend errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('re_realkey', 'no-reply@x.io', 'App', undefined, undefined, { record });
    await expect(svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>')).rejects.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });
});
