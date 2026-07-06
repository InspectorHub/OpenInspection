import { describe, it, expect } from 'vitest';
import { RecordingEmailProvider, sinkKey } from '../../../server/lib/email/providers/recording';

/** Minimal Map-backed KV double — only get/put are exercised. */
function fakeKV() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  } as unknown as KVNamespace;
  return { kv, store };
}

describe('sinkKey', () => {
  it('normalizes the recipient (trim + lowercase) under the e2e_email: prefix', () => {
    expect(sinkKey('  Foo@Bar.COM ')).toBe('e2e_email:foo@bar.com');
  });
});

describe('RecordingEmailProvider', () => {
  it('records the message under the normalized recipient key and returns ok', async () => {
    const { kv } = fakeKV();
    const res = await new RecordingEmailProvider(kv).sendEmail({
      from: 'noreply@x.com',
      to: 'User@Example.com',
      subject: 'Reset your password',
      html: '<a href="https://app.test/reset-password?token=abc-123">Reset</a>',
    });
    expect(res.ok).toBe(true);

    const raw = await kv.get(sinkKey('user@example.com'));
    expect(raw).toBeTruthy();
    const rec = JSON.parse(raw!);
    expect(rec.subject).toBe('Reset your password');
    expect(rec.html).toContain('reset-password?token=abc-123');
    expect(rec.text).toBeNull();
  });

  it('records under every recipient when `to` is an array', async () => {
    const { kv } = fakeKV();
    await new RecordingEmailProvider(kv).sendEmail({
      from: 'noreply@x.com',
      to: ['One@x.com', 'two@y.com'],
      subject: 's',
      html: 'h',
      text: 'plain',
    });
    expect(await kv.get(sinkKey('one@x.com'))).toBeTruthy();
    const two = JSON.parse((await kv.get(sinkKey('two@y.com')))!);
    expect(two.text).toBe('plain');
  });

  it('never sends and never throws for the inert webhook surface', async () => {
    const { kv } = fakeKV();
    const p = new RecordingEmailProvider(kv);
    expect(await p.validateCredentials()).toEqual({ ok: true });
    expect(await p.verifyWebhookSignature({} as never)).toBe(false);
    expect(p.parseWebhookEvents('{}')).toEqual([]);
  });
});
