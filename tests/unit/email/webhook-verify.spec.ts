import { describe, it, expect } from 'vitest';
import { ResendProvider } from '../../../server/lib/email/providers/resend';
import { SendgridProvider } from '../../../server/lib/email/providers/sendgrid';
import { PostmarkProvider } from '../../../server/lib/email/providers/postmark';
import { MailgunProvider } from '../../../server/lib/email/providers/mailgun';
import type { EmailWebhookContext } from '../../../server/lib/email/provider';

// ---------------------------------------------------------------------------
// In-test crypto helpers — re-implement each scheme independently so the spec
// signs synthetic payloads with the exact bytes the provider must verify.
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function baseCtx(over: Partial<EmailWebhookContext>): EmailWebhookContext {
  return { rawBody: '', headers: {}, secret: '', query: {}, ...over };
}

const FIXED_NOW = 1_700_000_000_000; // ms

// ===========================================================================
// Resend (Svix HMAC-SHA256)
// ===========================================================================
describe('ResendProvider.verifyWebhookSignature (Svix HMAC-SHA256)', () => {
  const svixKeyBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const whsec = `whsec_${bytesToBase64(svixKeyBytes)}`;
  const svixId = 'msg_2abc';
  const tsSeconds = Math.floor(FIXED_NOW / 1000);
  const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });

  async function signedHeaders(body: string, ts: number, id: string) {
    const sig = await hmacSha256(svixKeyBytes, `${id}.${ts}.${body}`);
    return {
      'svix-id': id,
      'svix-timestamp': String(ts),
      'svix-signature': `v1,${bytesToBase64(sig)}`,
    };
  }

  it('returns true for a correctly-signed payload', async () => {
    const headers = await signedHeaders(rawBody, tsSeconds, svixId);
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: whsec, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(true);
  });

  it('matches when multiple space-separated v1 sigs are present (any match)', async () => {
    const good = await signedHeaders(rawBody, tsSeconds, svixId);
    const headers = { ...good, 'svix-signature': `v1,AAAA ${good['svix-signature']}` };
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: whsec, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(true);
  });

  it('returns false for a tampered body', async () => {
    const headers = await signedHeaders(rawBody, tsSeconds, svixId);
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody: rawBody + 'x', headers, secret: whsec, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for the wrong key', async () => {
    const headers = await signedHeaders(rawBody, tsSeconds, svixId);
    const wrong = `whsec_${bytesToBase64(new Uint8Array(16).fill(99))}`;
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: wrong, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for a stale timestamp (> 300s)', async () => {
    const staleTs = tsSeconds - 400;
    const headers = await signedHeaders(rawBody, staleTs, svixId);
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: whsec, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false when a header is missing', async () => {
    const headers = await signedHeaders(rawBody, tsSeconds, svixId);
    delete (headers as Record<string, string>)['svix-id'];
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: whsec, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for an empty secret', async () => {
    const headers = await signedHeaders(rawBody, tsSeconds, svixId);
    const ok = await new ResendProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers, secret: '', nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// SendGrid (ECDSA P-256)
// ===========================================================================
describe('SendgridProvider.verifyWebhookSignature (ECDSA P-256)', () => {
  const tsSeconds = String(Math.floor(FIXED_NOW / 1000));
  const rawBody = JSON.stringify([{ event: 'delivered', email: 'a@b.com', sg_event_id: 'sg1' }]);

  async function makeKeypairAndSign(body: string, ts: string) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      new TextEncoder().encode(`${ts}${body}`),
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    return { secret: bytesToBase64(spki), sigB64: bytesToBase64(new Uint8Array(sig)) };
  }

  function headers(sigB64: string, ts: string) {
    return {
      'x-twilio-email-event-webhook-signature': sigB64,
      'x-twilio-email-event-webhook-timestamp': ts,
    };
  }

  it('returns true for a correctly-signed payload', async () => {
    const { secret, sigB64 } = await makeKeypairAndSign(rawBody, tsSeconds);
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers: headers(sigB64, tsSeconds), secret, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(true);
  });

  it('returns false for a tampered body', async () => {
    const { secret, sigB64 } = await makeKeypairAndSign(rawBody, tsSeconds);
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody: rawBody + 'x', headers: headers(sigB64, tsSeconds), secret, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for the wrong public key', async () => {
    const { sigB64 } = await makeKeypairAndSign(rawBody, tsSeconds);
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const otherSpki = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', other.publicKey)));
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers: headers(sigB64, tsSeconds), secret: otherSpki, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for a stale timestamp', async () => {
    const staleTs = String(Math.floor(FIXED_NOW / 1000) - 400);
    const { secret, sigB64 } = await makeKeypairAndSign(rawBody, staleTs);
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers: headers(sigB64, staleTs), secret, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false when a header is missing', async () => {
    const { secret, sigB64 } = await makeKeypairAndSign(rawBody, tsSeconds);
    const h = headers(sigB64, tsSeconds);
    delete (h as Record<string, string>)['x-twilio-email-event-webhook-timestamp'];
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers: h, secret, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for an empty secret', async () => {
    const { sigB64 } = await makeKeypairAndSign(rawBody, tsSeconds);
    const ok = await new SendgridProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ rawBody, headers: headers(sigB64, tsSeconds), secret: '', nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// Postmark (shared-token constant-time)
// ===========================================================================
describe('PostmarkProvider.verifyWebhookSignature (shared token)', () => {
  const TOKEN = 's3cr3t-token-value';

  it('returns true when query token matches', async () => {
    const ok = await new PostmarkProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ secret: TOKEN, query: { token: TOKEN } }),
    );
    expect(ok).toBe(true);
  });

  it('returns true when Basic-auth password matches', async () => {
    const headers = { authorization: `Basic ${btoa(`hook:${TOKEN}`)}` };
    const ok = await new PostmarkProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ secret: TOKEN, headers }),
    );
    expect(ok).toBe(true);
  });

  it('returns false for a wrong token', async () => {
    const ok = await new PostmarkProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ secret: TOKEN, query: { token: 'nope' } }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for an empty configured secret (fail-closed)', async () => {
    const ok = await new PostmarkProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ secret: '', query: { token: '' } }),
    );
    expect(ok).toBe(false);
  });

  it('returns false when no token is presented', async () => {
    const ok = await new PostmarkProvider({ apiKey: 'x' }).verifyWebhookSignature(
      baseCtx({ secret: TOKEN }),
    );
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// Mailgun (HMAC-SHA256 hex)
// ===========================================================================
describe('MailgunProvider.verifyWebhookSignature (HMAC-SHA256 hex)', () => {
  const signingKey = 'mg-signing-key';
  const keyBytes = new TextEncoder().encode(signingKey);
  const tsSeconds = Math.floor(FIXED_NOW / 1000);
  const token = 'tok_abc123';

  async function makeBody(ts: number, tok: string, key: Uint8Array): Promise<string> {
    const sigHex = bytesToHex(await hmacSha256(key, `${ts}${tok}`));
    return JSON.stringify({
      signature: { timestamp: String(ts), token: tok, signature: sigHex },
      'event-data': { event: 'delivered', recipient: 'a@b.com', id: 'mg1' },
    });
  }

  it('returns true for a correctly-signed body', async () => {
    const body = await makeBody(tsSeconds, token, keyBytes);
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: body, secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(true);
  });

  it('returns false for a tampered signature', async () => {
    const body = await makeBody(tsSeconds, token, keyBytes);
    const parsed = JSON.parse(body);
    parsed.signature.signature = 'deadbeef';
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: JSON.stringify(parsed), secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for the wrong signing key', async () => {
    const body = await makeBody(tsSeconds, token, new TextEncoder().encode('other-key'));
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: body, secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for a stale timestamp', async () => {
    const staleTs = tsSeconds - 400;
    const body = await makeBody(staleTs, token, keyBytes);
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: body, secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false when the signature object is missing', async () => {
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: JSON.stringify({ 'event-data': {} }), secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false for an empty secret', async () => {
    const body = await makeBody(tsSeconds, token, keyBytes);
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: body, secret: '', nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });

  it('returns false on malformed JSON body (never throws)', async () => {
    const ok = await new MailgunProvider({ apiKey: 'x', domain: 'd' }).verifyWebhookSignature(
      baseCtx({ rawBody: '{not json', secret: signingKey, nowMs: FIXED_NOW }),
    );
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// parseWebhookEvents — per provider
// ===========================================================================
describe('ResendProvider.parseWebhookEvents', () => {
  const p = new ResendProvider({ apiKey: 'x' });

  it('maps a hard bounce', () => {
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-06-27T10:00:00.000Z',
      data: { email_id: 'e1', to: ['a@b.com'], bounce: { type: 'Permanent' } },
    });
    expect(p.parseWebhookEvents(body)).toEqual([
      { type: 'bounced', email: 'a@b.com', hardBounce: true, providerEventId: 'e1:email.bounced', at: Date.parse('2026-06-27T10:00:00.000Z') },
    ]);
  });

  it('maps a soft bounce (transient)', () => {
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-06-27T10:00:00.000Z',
      data: { email_id: 'e2', to: 'a@b.com', bounce: { type: 'Transient' } },
    });
    const out = p.parseWebhookEvents(body);
    expect(out[0]).toMatchObject({ type: 'bounced', email: 'a@b.com', hardBounce: false });
  });

  it('maps a complaint', () => {
    const body = JSON.stringify({ type: 'email.complained', data: { email_id: 'e3', to: ['a@b.com'] } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'complained', email: 'a@b.com' });
  });

  it('maps a delivered', () => {
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e4', to: ['a@b.com'] } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'delivered', email: 'a@b.com' });
  });

  it('returns [] on malformed JSON', () => {
    expect(p.parseWebhookEvents('{not json')).toEqual([]);
  });

  it('returns [] when email is absent', () => {
    expect(p.parseWebhookEvents(JSON.stringify({ type: 'email.delivered', data: { email_id: 'e5' } }))).toEqual([]);
  });
});

describe('SendgridProvider.parseWebhookEvents', () => {
  const p = new SendgridProvider({ apiKey: 'x' });

  it('maps mixed events (hard bounce, soft, complaint, delivered)', () => {
    const body = JSON.stringify([
      { event: 'bounce', email: 'h@b.com', sg_event_id: 's1', timestamp: 1700000000 },
      { event: 'dropped', email: 's@b.com', sg_event_id: 's2', timestamp: 1700000001 },
      { event: 'spamreport', email: 'c@b.com', sg_event_id: 's3', timestamp: 1700000002 },
      { event: 'delivered', email: 'd@b.com', sg_event_id: 's4', timestamp: 1700000003 },
      { event: 'open', email: 'o@b.com', sg_event_id: 's5', timestamp: 1700000004 },
    ]);
    expect(p.parseWebhookEvents(body)).toEqual([
      { type: 'bounced', email: 'h@b.com', hardBounce: true, providerEventId: 's1', at: 1700000000000 },
      { type: 'bounced', email: 's@b.com', hardBounce: false, providerEventId: 's2', at: 1700000001000 },
      { type: 'complained', email: 'c@b.com', providerEventId: 's3', at: 1700000002000 },
      { type: 'delivered', email: 'd@b.com', providerEventId: 's4', at: 1700000003000 },
    ]);
  });

  it('returns [] on malformed JSON', () => {
    expect(p.parseWebhookEvents('not json')).toEqual([]);
  });

  it('returns [] when body is not an array', () => {
    expect(p.parseWebhookEvents(JSON.stringify({ event: 'delivered' }))).toEqual([]);
  });
});

describe('PostmarkProvider.parseWebhookEvents', () => {
  const p = new PostmarkProvider({ apiKey: 'x' });

  it('maps a hard bounce', () => {
    const body = JSON.stringify({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@b.com', ID: 123, BouncedAt: '2026-06-27T10:00:00Z' });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'bounced', email: 'a@b.com', hardBounce: true, providerEventId: '123' });
  });

  it('maps a soft bounce', () => {
    const body = JSON.stringify({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'a@b.com', ID: 124 });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'bounced', hardBounce: false });
  });

  it('maps a complaint', () => {
    const body = JSON.stringify({ RecordType: 'SpamComplaint', Email: 'a@b.com', ID: 125 });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'complained', email: 'a@b.com' });
  });

  it('maps a delivery (Recipient fallback)', () => {
    const body = JSON.stringify({ RecordType: 'Delivery', Recipient: 'a@b.com', MessageID: 'm1' });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'delivered', email: 'a@b.com', providerEventId: 'm1' });
  });

  it('returns [] on malformed JSON', () => {
    expect(p.parseWebhookEvents('{bad')).toEqual([]);
  });
});

describe('MailgunProvider.parseWebhookEvents', () => {
  const p = new MailgunProvider({ apiKey: 'x', domain: 'd' });

  it('maps a permanent failure (hard bounce)', () => {
    const body = JSON.stringify({ 'event-data': { event: 'failed', severity: 'permanent', recipient: 'a@b.com', id: 'mg1', timestamp: 1700000000 } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'bounced', email: 'a@b.com', hardBounce: true, providerEventId: 'mg1', at: 1700000000000 });
  });

  it('maps a temporary failure (soft bounce)', () => {
    const body = JSON.stringify({ 'event-data': { event: 'failed', severity: 'temporary', recipient: 'a@b.com', id: 'mg2', timestamp: 1700000000 } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'bounced', hardBounce: false });
  });

  it('maps a complaint', () => {
    const body = JSON.stringify({ 'event-data': { event: 'complained', recipient: 'a@b.com', id: 'mg3', timestamp: 1700000000 } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'complained', email: 'a@b.com' });
  });

  it('maps a delivered', () => {
    const body = JSON.stringify({ 'event-data': { event: 'delivered', recipient: 'a@b.com', id: 'mg4', timestamp: 1700000000 } });
    expect(p.parseWebhookEvents(body)[0]).toMatchObject({ type: 'delivered', email: 'a@b.com' });
  });

  it('returns [] on malformed JSON', () => {
    expect(p.parseWebhookEvents('{bad')).toEqual([]);
  });
});
