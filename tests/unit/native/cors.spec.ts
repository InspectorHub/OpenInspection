/**
 * CORS for the native app's WebView origins, through the REAL app. The app's
 * pages are served from capacitor://localhost (iOS) and https://localhost
 * (Android), so every call to the API is cross-origin.
 *
 * Every grant for a native origin is paired with the same request from another
 * origin, which gets no CORS headers (the origin is never reflected) and must NOT
 * pick up the native-only headers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { NATIVE_APP_ORIGINS, nativeCorsHeaders } from '../../../server/lib/native/cors-origins';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const nativeProps: NativeProps = {
  kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
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
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
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
      // The session answer carries the server clock. Date is not a safelisted header, so it has to be exposed.
      expect(csv(res.headers.get('Access-Control-Expose-Headers'))).toContain('date');
      expect(csv(res.headers.get('Access-Control-Expose-Headers'))).not.toContain('set-cookie');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });
  }

  it('never reflects an arbitrary origin: no Allow-Origin, no credentials, Vary: Origin', async () => {
    const pre = await preflight(OTHER_ORIGIN);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(pre.headers.get('Vary')).toContain('Origin');

    const res = await send('/api/client/compat?platform=ios', { headers: { Origin: OTHER_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull();
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('gives the deployment own origin credentials, with a full preflight', async () => {
    const own = 'http://localhost';
    const pre = await preflight(own);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(own);
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(csv(pre.headers.get('Access-Control-Allow-Headers'))).toEqual(['content-type', 'authorization', 'x-csrf-token', 'x-token-relay']);
    expect(csv(pre.headers.get('Access-Control-Allow-Methods'))).toContain('patch');
    expect(pre.headers.get('Vary')).toContain('Origin');

    const res = await send('/api/client/compat?platform=ios', { headers: { Origin: own } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(own);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(csv(res.headers.get('Access-Control-Expose-Headers'))).toEqual(['set-cookie']);
  });

  it('gives credentials to an origin on CORS_ALLOWED_ORIGINS and to nobody else', async () => {
    h ??= await createHarness('standalone');
    const env = { ...h.env, CORS_ALLOWED_ORIGINS: 'https://admin.example.com, not a url, https://other-admin.example.com/' } as typeof h.env;
    const exec = makeExecutionContext({ label: 'cors-allow' });
    const call = async (origin: string, method = 'GET') => {
      const res = await app.request('/api/client/compat?platform=ios', { method, headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } }, env, exec.ctx);
      await exec.settle();
      return res;
    };
    for (const origin of ['https://admin.example.com', 'https://other-admin.example.com']) {
      const res = await call(origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Credentials'), origin).toBe('true');
      expect((await call(origin, 'OPTIONS')).headers.get('Access-Control-Allow-Credentials'), origin).toBe('true');
    }
    for (const origin of ['https://admin.example.com.evil.example', 'http://admin.example.com', 'https://evil.example']) {
      const res = await call(origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Credentials'), origin).toBeNull();
    }
  });

  it('allows the Vite dev origin only on a loopback host', async () => {
    const dev = 'http://localhost:5173';
    expect((await send('/api/client/compat?platform=ios', { headers: { Origin: dev } })).headers.get('Access-Control-Allow-Origin')).toBe(dev);
    h ??= await createHarness('standalone');
    const exec = makeExecutionContext({ label: 'cors-prod-host' });
    const res = await app.request('https://app.example.com/api/client/compat?platform=ios', { headers: { Origin: dev } }, h.env, exec.ctx);
    await exec.settle();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers the public widget routes for any origin with a wildcard and never credentials', async () => {
    for (const path of ['/api/public/widget/event', '/api/public/book', '/api/public/slots']) {
      const pre = await send(path, {
        method: 'OPTIONS',
        headers: { Origin: OTHER_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      expect(pre.status, path).toBeLessThan(300);
      expect(pre.headers.get('Access-Control-Allow-Origin'), path).toBe('*');
      expect(pre.headers.get('Access-Control-Allow-Credentials'), path).toBeNull();
      expect(csv(pre.headers.get('Access-Control-Allow-Headers')), path).toContain('content-type');
    }
    const res = await send('/api/public/widget/event', {
      method: 'POST',
      headers: { Origin: OTHER_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'view' }),
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('never pairs a wildcard with credentials on any route or origin', async () => {
    const paths = ['/api/client/compat?platform=ios', '/api/public/widget/event', '/api/public/book', '/api/inspections'];
    for (const path of paths) {
      for (const origin of [OTHER_ORIGIN, 'http://localhost', 'capacitor://localhost']) {
        for (const method of ['GET', 'OPTIONS']) {
          const res = await send(path, { method, headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
          if (res.headers.get('Access-Control-Allow-Origin') === '*') {
            expect(res.headers.get('Access-Control-Allow-Credentials'), `${method} ${path} ${origin}`).toBeNull();
          }
        }
      }
    }
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
