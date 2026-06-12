import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../server/services/email.service';

describe('EmailService meter hook', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))));
  afterEach(() => vi.unstubAllGlobals());

  it('awaits meter.record once after a successful send and returns delivered:true', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('re_realkey', 'no-reply@x.io', 'App', undefined, undefined, { record });
    const result = await svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>');
    expect(record).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ delivered: true });
  });
  it('does NOT record when the API key is missing and returns delivered:false', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('your_api_key', 'no-reply@x.io', 'App', undefined, undefined, { record });
    const result = await svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>');
    expect(record).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false });
  });
  it('does NOT record when Resend errors and throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const record = vi.fn().mockResolvedValue(undefined);
    const svc = new EmailService('re_realkey', 'no-reply@x.io', 'App', undefined, undefined, { record });
    await expect(svc.sendEmail(['a@b.com'], 'Subj', '<p>hi</p>')).rejects.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });
});
