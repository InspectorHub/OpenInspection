import { describe, it, expect, vi, afterEach } from 'vitest';
import { SendgridProvider } from '../../../server/lib/email/providers/sendgrid';
import { PostmarkProvider } from '../../../server/lib/email/providers/postmark';
import { MailgunProvider } from '../../../server/lib/email/providers/mailgun';

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------
describe('SendgridProvider', () => {
  it('POSTs v3/mail/send with bearer + personalizations (single to)', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SG.x');
    const body = JSON.parse(init.body as string);
    expect(body.personalizations[0].to).toEqual([{ email: 'b@y.com' }]);
    expect(body.from.email).toBe('a@x.com');
    expect(body.subject).toBe('Hi');
    expect(body.content[0]).toEqual({ type: 'text/html', value: '<p>h</p>' });
  });

  it('normalizes array to recipients in personalizations', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: ['b@y.com', 'c@z.com'],
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.personalizations[0].to).toEqual([{ email: 'b@y.com' }, { email: 'c@z.com' }]);
  });

  it('includes reply_to only when replyTo is set', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
      replyTo: 'reply@x.com',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.reply_to).toEqual({ email: 'reply@x.com' });
  });

  it('omits reply_to when replyTo is absent', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect('reply_to' in body).toBe(false);
  });

  it('returns ok:false with error message on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Invalid API key' }] }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new SendgridProvider({ apiKey: 'SG.bad' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('falls back to SendGrid <status> when error body is unparseable', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'SendGrid 500' });
  });

  it('returns ok:false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network failure'); }));
    const res = await new SendgridProvider({ apiKey: 'SG.x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'network failure' });
  });

  it('validateCredentials GETs /v3/scopes and returns ok:true on 200', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new SendgridProvider({ apiKey: 'SG.x' }).validateCredentials!();
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/scopes');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SG.x');
  });

  it('validateCredentials returns ok:false on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    const res = await new SendgridProvider({ apiKey: 'SG.x' }).validateCredentials!();
    expect(res).toEqual({ ok: false, error: 'SendGrid 403' });
  });
});

// ---------------------------------------------------------------------------
// Postmark
// ---------------------------------------------------------------------------
describe('PostmarkProvider', () => {
  it('POSTs to /email with server-token header (single to)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ MessageID: 'msg-123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new PostmarkProvider({ apiKey: 'pm-token' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: true, id: 'msg-123' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('pm-token');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.To).toBe('b@y.com');
    expect(body.From).toBe('a@x.com');
    expect(body.Subject).toBe('Hi');
    expect(body.HtmlBody).toBe('<p>h</p>');
  });

  it('normalizes array to comma-separated To', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ MessageID: 'msg-456' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new PostmarkProvider({ apiKey: 'pm-token' }).sendEmail({
      from: 'a@x.com',
      to: ['b@y.com', 'c@z.com'],
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.To).toBe('b@y.com,c@z.com');
  });

  it('includes ReplyTo only when replyTo is set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ MessageID: 'msg-789' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new PostmarkProvider({ apiKey: 'pm-token' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
      replyTo: 'reply@x.com',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.ReplyTo).toBe('reply@x.com');
  });

  it('omits ReplyTo when replyTo is absent', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ MessageID: 'msg-abc' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new PostmarkProvider({ apiKey: 'pm-token' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect('ReplyTo' in body).toBe(false);
  });

  it('returns ok:false with Message field on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ Message: 'Bad token', ErrorCode: 10 }), { status: 422 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new PostmarkProvider({ apiKey: 'pm-bad' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'Bad token' });
  });

  it('falls back to Postmark <status> when error body is unparseable', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new PostmarkProvider({ apiKey: 'pm-x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'Postmark 500' });
  });

  it('returns ok:false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const res = await new PostmarkProvider({ apiKey: 'pm-x' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'connection refused' });
  });

  it('validateCredentials GETs /server and returns ok:true on 200', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new PostmarkProvider({ apiKey: 'pm-token' }).validateCredentials!();
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/server');
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('pm-token');
  });

  it('validateCredentials returns ok:false on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const res = await new PostmarkProvider({ apiKey: 'pm-x' }).validateCredentials!();
    expect(res).toEqual({ ok: false, error: 'Postmark 401' });
  });
});

// ---------------------------------------------------------------------------
// Mailgun
// ---------------------------------------------------------------------------
describe('MailgunProvider', () => {
  it('POSTs form-encoded to v3/<domain>/messages with Basic auth (single to)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: '<mg-abc@domain>', message: 'Queued. Thank you.' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: true, id: '<mg-abc@domain>' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailgun.net/v3/mg.example.com/messages');
    const expectedAuth = `Basic ${btoa('api:key-mg')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body as string);
    expect(params.get('from')).toBe('a@x.com');
    expect(params.getAll('to')).toEqual(['b@y.com']);
    expect(params.get('subject')).toBe('Hi');
    expect(params.get('html')).toBe('<p>h</p>');
  });

  it('appends one to entry per address in array', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: '<mg-def@domain>' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: ['b@y.com', 'c@z.com'],
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.getAll('to')).toEqual(['b@y.com', 'c@z.com']);
  });

  it('includes h:Reply-To only when replyTo is set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: '<mg-ghi@domain>' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
      replyTo: 'reply@x.com',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get('h:Reply-To')).toBe('reply@x.com');
  });

  it('omits h:Reply-To when replyTo is absent', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: '<mg-jkl@domain>' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.has('h:Reply-To')).toBe(false);
  });

  it('returns ok:false with message field on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Forbidden. Provide valid API credentials.' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new MailgunProvider({ apiKey: 'key-bad', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'Forbidden. Provide valid API credentials.' });
  });

  it('falls back to Mailgun <status> when error body is unparseable', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'Mailgun 500' });
  });

  it('returns ok:false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const res = await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).sendEmail({
      from: 'a@x.com',
      to: 'b@y.com',
      subject: 'Hi',
      html: '<p>h</p>',
    });
    expect(res).toEqual({ ok: false, error: 'timeout' });
  });

  it('validateCredentials GETs /v3/<domain> with Basic auth and returns ok:true', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).validateCredentials!();
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailgun.net/v3/mg.example.com');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('api:key-mg')}`);
  });

  it('validateCredentials returns ok:false on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const res = await new MailgunProvider({ apiKey: 'key-mg', domain: 'mg.example.com' }).validateCredentials!();
    expect(res).toEqual({ ok: false, error: 'Mailgun 401' });
  });
});
