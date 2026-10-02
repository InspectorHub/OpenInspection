import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResendProvider, classifyResendError } from '../../../server/lib/email/providers/resend';
import { recordingFetch } from '../helpers/fetch-mock';

describe('ResendProvider.sendEmail', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the Resend API with bearer auth + JSON body', async () => {
    const fetchMock = recordingFetch(async () => new Response(JSON.stringify({ id: 'eml_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>hi</p>',
    });
    expect(res).toEqual({ ok: true, id: 'eml_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>hi</p>' });
  });

  it('returns ok:false with the API error message on non-2xx', async () => {
    vi.stubGlobal('fetch', recordingFetch(async () => new Response(JSON.stringify({ message: 'bad key' }), { status: 401 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h' });
    expect(res).toEqual({ ok: false, error: 'bad key', kind: 'transient' });
  });

  it('includes reply_to in body when replyTo is set', async () => {
    const fetchMock = recordingFetch(async () => new Response(JSON.stringify({ id: 'eml_2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h', replyTo: 'reply@x.com',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reply_to).toBe('reply@x.com');
  });

  it('omits reply_to when replyTo is not set', async () => {
    const fetchMock = recordingFetch(async () => new Response(JSON.stringify({ id: 'eml_3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('reply_to' in body).toBe(false);
  });

  it('passes array to when given string[]', async () => {
    const fetchMock = recordingFetch(async () => new Response(JSON.stringify({ id: 'eml_4' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: ['b@y.com', 'c@y.com'], subject: 's', html: 'h',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(['b@y.com', 'c@y.com']);
  });

  it('returns ok:false with fallback message when error body is not parseable', async () => {
    vi.stubGlobal('fetch', recordingFetch(async () => new Response('not json', { status: 500 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h' });
    expect(res).toMatchObject({ ok: false });
    expect((res as { ok: false; error: string }).error).toContain('500');
  });
});

describe('classifyResendError', () => {
  it('classifies 403 validation_error with "suppressed" in message as suppressed', () => {
    expect(classifyResendError(403, 'validation_error', 'The recipient address foo@bar.com is suppressed')).toBe('suppressed');
  });

  it('classifies 403 validation_error without "suppressed" as sender_domain', () => {
    expect(classifyResendError(403, 'validation_error', 'The domain.com domain is not verified.')).toBe('sender_domain');
    expect(classifyResendError(403, 'validation_error', 'You can only send testing emails to your own email address')).toBe('sender_domain');
  });

  it('classifies 429 daily_quota_exceeded as quota_exceeded', () => {
    expect(classifyResendError(429, 'daily_quota_exceeded', 'You have exceeded your daily email sending quota.')).toBe('quota_exceeded');
  });

  it('classifies 429 monthly_quota_exceeded as quota_exceeded', () => {
    expect(classifyResendError(429, 'monthly_quota_exceeded', 'You have exceeded your monthly email sending quota.')).toBe('quota_exceeded');
  });

  it('classifies 429 rate_limit_exceeded as transient', () => {
    expect(classifyResendError(429, 'rate_limit_exceeded', 'Too many requests.')).toBe('transient');
  });

  it('classifies 500 application_error as transient', () => {
    expect(classifyResendError(500, 'application_error', 'An unexpected error occurred.')).toBe('transient');
  });

  it('classifies 503 service_unavailable as transient', () => {
    expect(classifyResendError(503, 'service_unavailable', 'API is temporarily unavailable')).toBe('transient');
  });

  it('classifies 401 missing_api_key as transient', () => {
    expect(classifyResendError(401, 'missing_api_key', 'Missing API key in the authorization header.')).toBe('transient');
  });
});

describe('ResendProvider.validateCredentials', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns ok:true when Resend domains endpoint is 200', async () => {
    vi.stubGlobal('fetch', recordingFetch(async () => new Response('{}', { status: 200 })));
    const res = await new ResendProvider({ apiKey: 're_test' }).validateCredentials!();
    expect(res).toEqual({ ok: true });
  });

  it('returns ok:false when Resend domains endpoint is 401', async () => {
    vi.stubGlobal('fetch', recordingFetch(async () => new Response('{}', { status: 401 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).validateCredentials!();
    expect(res).toMatchObject({ ok: false });
  });
});
