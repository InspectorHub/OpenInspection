import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

const writeAuditLog = vi.fn();
vi.mock('../../../server/lib/audit', () => ({ writeAuditLog: (p: unknown) => writeAuditLog(p) }));

import { isNativeAuthRequest, isNativeRedirectUri, completeNativeAuthorization } from '../../../server/lib/auth/native-consent';

const authReq = (scope: string[]): AuthRequest => ({
  responseType: 'code', clientId: 'c1', redirectUri: 'io.example.app:/cb', scope, state: 's',
} as AuthRequest);

function oauth() {
  const completeAuthorization = vi.fn(async (_opts: { scope: string[]; props: Record<string, unknown> }) => ({ redirectTo: 'io.example.app:/cb?code=abc' }));
  return { helpers: { completeAuthorization } as unknown as OAuthHelpers, completeAuthorization };
}

const base = { db: {} as D1Database, clientName: 'Field App', ctx: undefined, env: { NATIVE_CLIENT_ENABLED: 'true' } };

beforeEach(() => writeAuditLog.mockClear());

describe('isNativeAuthRequest', () => {
  it('is true only when native is among the requested scopes', () => {
    expect(isNativeAuthRequest(['native'])).toBe(true);
    expect(isNativeAuthRequest(['inspections:read'])).toBe(false);
    expect(isNativeAuthRequest(undefined)).toBe(false);
  });
});

describe('isNativeRedirectUri', () => {
  const accepted = [
    'io.inspectorhub.app:/oauth/callback',
    'io.example.fieldapp:/oauth/callback',
    'http://127.0.0.1:53682/cb',
    'http://127.0.0.1/cb',
    'http://[::1]:8000/cb',
  ];
  const refused = [
    'https://evil.example/cb',
    'http://evil.example/cb',
    'http://localhost/cb',
    'http://localhost:8080/cb',
    'https://127.0.0.1/cb',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///x',
    'myapp:/cb',
    '',
    '/relative/path',
    'HTTP://127.0.0.1.evil.example/',
    'http://127.0.0.1@evil.example/cb',
    'http://user:pw@127.0.0.1/cb',
  ];
  it.each(accepted)('accepts %s', (uri) => expect(isNativeRedirectUri(uri)).toBe(true));
  it.each(refused)('refuses %j', (uri) => expect(isNativeRedirectUri(uri)).toBe(false));
});

describe('completeNativeAuthorization', () => {
  it('grants only the native scope with native props, and audits native.grant.created', async () => {
    const { helpers, completeAuthorization } = oauth();
    const redirectTo = await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: authReq(['native', 'inspections:write']),
      identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    });
    expect(redirectTo).toBe('io.example.app:/cb?code=abc');
    const arg = completeAuthorization.mock.calls[0]?.[0];
    expect(arg?.scope).toEqual(['native']);
    expect(arg?.props).toMatchObject({ kind: 'native', userId: 'u1', tenantId: 't1', role: 'inspector' });
    expect(typeof arg?.props.lastUsedAt).toBe('number');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'native.grant.created', tenantId: 't1', userId: 'u1', metadata: { clientId: 'c1' },
    }));
  });

  it('refuses with 404 when NATIVE_CLIENT_ENABLED is off, and grants once it is on', async () => {
    const off = oauth();
    for (const env of [{}, { NATIVE_CLIENT_ENABLED: '0' }]) {
      const err = await completeNativeAuthorization({
        ...base, env, oauth: off.helpers, authReq: authReq(['native']),
        identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(404);
    }
    expect(off.completeAuthorization).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    const on = oauth();
    await completeNativeAuthorization({
      ...base, oauth: on.helpers, authReq: authReq(['native']),
      identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    });
    expect(on.completeAuthorization).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect URI that is not private-scheme or loopback with 400 and no grant', async () => {
    const { helpers, completeAuthorization } = oauth();
    const bad: AuthRequest = { ...authReq(['native']), redirectUri: 'https://evil.example/cb' };
    const err = await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: bad, identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(400);
    expect(completeAuthorization).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    const loopback: AuthRequest = { ...authReq(['native']), redirectUri: 'http://127.0.0.1:53682/cb' };
    await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: loopback, identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    });
    expect(completeAuthorization).toHaveBeenCalledTimes(1);
  });

  it('refuses the agent role with 403 and creates no grant and no audit row', async () => {
    const { helpers, completeAuthorization } = oauth();
    const err = await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: authReq(['native']),
      identity: { userId: 'u2', tenantId: 't1', role: 'agent' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(403);
    expect(completeAuthorization).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
