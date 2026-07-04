import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResendProvider } from '../../../server/lib/email/providers/resend';

describe('ResendProvider.sendEmail', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the Resend API with bearer auth + JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'eml_1' }), { status: 200 }));
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad key' }), { status: 401 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h' });
    expect(res).toEqual({ ok: false, error: 'bad key' });
  });

  it('includes reply_to in body when replyTo is set', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'eml_2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h', replyTo: 'reply@x.com',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reply_to).toBe('reply@x.com');
  });

  it('omits reply_to when replyTo is not set', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'eml_3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect('reply_to' in body).toBe(false);
  });

  it('passes array to when given string[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'eml_4' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendProvider({ apiKey: 're_test' }).sendEmail({
      from: 'a@x.com', to: ['b@y.com', 'c@y.com'], subject: 's', html: 'h',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(['b@y.com', 'c@y.com']);
  });

  it('returns ok:false with fallback message when error body is not parseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 's', html: 'h' });
    expect(res).toMatchObject({ ok: false });
    expect((res as { ok: false; error: string }).error).toContain('500');
  });
});

describe('ResendProvider.validateCredentials', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns ok:true when Resend domains endpoint is 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const res = await new ResendProvider({ apiKey: 're_test' }).validateCredentials!();
    expect(res).toEqual({ ok: true });
  });

  it('returns ok:false when Resend domains endpoint is 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const res = await new ResendProvider({ apiKey: 're_bad' }).validateCredentials!();
    expect(res).toMatchObject({ ok: false });
  });
});
