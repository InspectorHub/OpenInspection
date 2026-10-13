/**
 * CORS for the native app's WebView origins, through the REAL app. The app's
 * pages are served from capacitor://localhost (iOS) and https://localhost
 * (Android), so every call to the API is cross-origin.
 *
 * Every grant for a native origin is paired with the same request from another
 * origin, which must keep today's behaviour (reflected origin, baseline header
 * lists) and must NOT pick up the native-only headers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { NATIVE_APP_ORIGINS, nativeCorsHeaders } from '../../../server/lib/native/cors-origins';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const nativeProps: NativeProps = {
  kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0,
};
const provider = {
  unwrapToken: async (t: string) => (t === 'u:g:s'
    ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props: nativeProps } }
    : null),
};

const OTHER_ORIGIN = 'https://other.example';
const csv = (v: string | null): string[] => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

describe('CORS for native app origins (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function send(path: string, init: RequestInit): Promise<Response> {
    h ??= await createHarness('standalone');
    const env = {
      ...h.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider,
      NATIVE_MIN_VERSION_IOS: '1.2.0',
    } as typeof h.env;
    const exec = makeExecutionContext({ label: 'cors' });
    const res = await app.request(path, init, env, exec.ctx);
    await exec.settle();
    return res;
  }

  const preflight = (origin: string) => send('/api/client/session', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,idempotency-key,x-client-version,x-client-platform,content-type',
    },
  });

  it('names exactly the two WebView origins', () => {
    expect([...NATIVE_APP_ORIGINS]).toEqual(['capacitor://localhost', 'https://localhost']);
  });

  for (const origin of NATIVE_APP_ORIGINS) {
    it(`answers a preflight from ${origin} with that origin and the native header allowances`, async () => {
      const res = await preflight(origin);
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      const allowed = csv(res.headers.get('Access-Control-Allow-Headers'));
      for (const name of ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Client-Version', 'X-Client-Platform']) {
        expect(allowed, name).toContain(name.toLowerCase());
      }
      for (const name of nativeCorsHeaders.allowHeaders) expect(allowed).toContain(name.toLowerCase());
    });

    it(`lets ${origin} read the answer and the X-Client-Upgrade verdict`, async () => {
      const res = await send('/api/client/session', {
        headers: {
          Origin: origin, Authorization: 'Bearer u:g:s',
          'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0',
        },
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get('X-Client-Upgrade')).toBe('required');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(csv(res.headers.get('Access-Control-Expose-Headers'))).toContain('x-client-upgrade');
    });
  }

  it('keeps the existing behaviour for any other origin: reflected, baseline headers, no native extras', async () => {
    const pre = await preflight(OTHER_ORIGIN);
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(OTHER_ORIGIN);
    expect(csv(pre.headers.get('Access-Control-Allow-Headers'))).toEqual(['content-type', 'authorization', 'x-csrf-token', 'x-token-relay']);

    const res = await send('/api/client/compat?platform=ios', { headers: { Origin: OTHER_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(OTHER_ORIGIN);
    expect(csv(res.headers.get('Access-Control-Expose-Headers'))).toEqual(['set-cookie']);
  });

  it('adds no CORS headers when the request has no Origin', async () => {
    const res = await send('/api/client/compat?platform=ios', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not treat look-alike origins as native origins', async () => {
    for (const origin of ['https://localhost:8443', 'http://localhost', 'capacitor://localhost.evil.example']) {
      const res = await preflight(origin);
      expect(csv(res.headers.get('Access-Control-Allow-Headers')), origin).not.toContain('idempotency-key');
    }
  });
});
