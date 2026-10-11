import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendProvider } from '../../../server/lib/email/providers/resend';
import { logger } from '../../../server/lib/logger';
import { recordingFetch } from '../helpers/fetch-mock';

afterEach(() => vi.restoreAllMocks());

const send = (status: number, body: Record<string, unknown>) => {
  vi.stubGlobal('fetch', recordingFetch(async () => new Response(JSON.stringify(body), { status })));
  return new ResendProvider({ apiKey: 're_test' }).sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h' });
};

/**
 * Alert rules can match the log message but not the data object, so the failure
 * kind has to be in the message, and only a failure that needs a human is an alert.
 */
describe('Resend delivery failure logging', () => {
  it('raises an alert when the sending quota is used up', async () => {
    const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
    const res = await send(429, { name: 'daily_quota_exceeded', message: 'You have exceeded your daily sending quota' });
    expect(res).toMatchObject({ ok: false, kind: 'quota_exceeded' });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toBe('email-quota-exceeded');
  });

  it('logs a suppressed recipient as a warning: it is expected, not an error', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await send(403, { name: 'validation_error', message: 'The recipient is suppressed' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('names the failure kind in the message of any other failure', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    await send(500, { name: 'application_error', message: 'boom' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('(transient)');
  });
});
