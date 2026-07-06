import { describe, it, expect } from 'vitest';
import testHooks from '../../../server/api/test-hooks';
import { sinkKey } from '../../../server/lib/email/providers/recording';

/** Map-backed KV double — only get/put are exercised. */
function kvWith(entries: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(entries));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  } as unknown as KVNamespace;
}

/** Invoke the mounted router with a given env (Hono's 3rd request arg = Bindings). */
function call(env: Record<string, unknown>, path = '/last-email?to=a@b.com') {
  return testHooks.request(path, {}, env as never);
}

describe('GET /api/__test__/last-email — fail-closed gate', () => {
  it('404s when E2E_EMAIL_SINK is unset (the production default)', async () => {
    const res = await call({ TENANT_CACHE: kvWith() });
    expect(res.status).toBe(404);
  });

  it('404s when the flag is any value other than "1"', async () => {
    const res = await call({ E2E_EMAIL_SINK: '0', TENANT_CACHE: kvWith() });
    expect(res.status).toBe(404);
  });

  it('400s when `to` is missing (sink enabled)', async () => {
    const res = await call({ E2E_EMAIL_SINK: '1', TENANT_CACHE: kvWith() }, '/last-email');
    expect(res.status).toBe(400);
  });

  it('404s when no email was recorded for the recipient', async () => {
    const res = await call({ E2E_EMAIL_SINK: '1', TENANT_CACHE: kvWith() }, '/last-email?to=nobody@b.com');
    expect(res.status).toBe(404);
  });

  it('returns the recorded email when the sink is enabled and one exists', async () => {
    const kv = kvWith({
      [sinkKey('a@b.com')]: JSON.stringify({
        subject: 'Reset your password',
        html: '<a href="https://app/reset-password?token=xyz-1">Reset</a>',
        text: null,
      }),
    });
    const res = await call({ E2E_EMAIL_SINK: '1', TENANT_CACHE: kv });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subject).toBe('Reset your password');
    expect(body.data.html).toContain('token=xyz-1');
  });
});
