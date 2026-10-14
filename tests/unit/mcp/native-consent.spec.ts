import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

const writeAuditLog = vi.fn();
vi.mock('../../../server/lib/audit', () => ({ writeAuditLog: (p: unknown) => writeAuditLog(p) }));

import {
  isNativeAuthRequest, isNativeRedirectUri, completeNativeAuthorization, NATIVE_GRANTS_PER_USER_MAX, hasNativePkce, nativeRedirectDisplay,
} from '../../../server/lib/auth/native-consent';

const authReq = (scope: string[]): AuthRequest => ({
  responseType: 'code', clientId: 'c1', redirectUri: 'io.example.app:/cb', scope, state: 's',
  codeChallenge: 'x'.repeat(43), codeChallengeMethod: 'S256',
});

describe('hasNativePkce', () => {
  it('is true only for a non-empty challenge with the S256 method', () => {
    expect(hasNativePkce(authReq(['native']))).toBe(true);
    expect(hasNativePkce({ ...authReq(['native']), codeChallenge: undefined })).toBe(false);
    expect(hasNativePkce({ ...authReq(['native']), codeChallenge: '' })).toBe(false);
    expect(hasNativePkce({ ...authReq(['native']), codeChallengeMethod: 'plain' })).toBe(false);
    expect(hasNativePkce({ ...authReq(['native']), codeChallengeMethod: undefined })).toBe(false);
  });
});

describe('nativeRedirectDisplay', () => {
  it('names the scheme of a private-use redirect and flags a loopback one', () => {
    expect(nativeRedirectDisplay('io.inspectorhub.app:/oauth/callback')).toEqual({ loopback: false, scheme: 'io.inspectorhub.app' });
    expect(nativeRedirectDisplay('http://127.0.0.1:53682/cb')).toEqual({ loopback: true, scheme: '' });
    expect(nativeRedirectDisplay('http://[::1]/cb')).toEqual({ loopback: true, scheme: '' });
  });
});

interface FakeGrant { id: string; createdAt: number; metadata: { kind?: string; clientName?: string } }

function oauth(existing: FakeGrant[] = []) {
  const completeAuthorization = vi.fn(async (_opts: { scope: string[]; props: Record<string, unknown>; revokeExistingGrants?: boolean }) => ({ redirectTo: 'io.example.app:/cb?code=abc' }));
  const listUserGrants = vi.fn(async () => ({ items: existing }));
  const revokeGrant = vi.fn(async (_grantId: string, _userId: string) => undefined);
  return {
    helpers: { completeAuthorization, listUserGrants, revokeGrant } as unknown as OAuthHelpers,
    completeAuthorization, listUserGrants, revokeGrant,
  };
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
    expect(typeof arg?.props.grantedAt).toBe('number');
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

  it('refuses a request without a PKCE S256 challenge with 400 and no grant', async () => {
    const { helpers, completeAuthorization } = oauth();
    const identity = { userId: 'u1', tenantId: 't1', role: 'inspector' } as const;
    const variants: AuthRequest[] = [
      { ...authReq(['native']), codeChallenge: undefined, codeChallengeMethod: undefined },
      { ...authReq(['native']), codeChallengeMethod: 'plain' },
      { ...authReq(['native']), codeChallengeMethod: undefined },
    ];
    for (const bad of variants) {
      const err = await completeNativeAuthorization({ ...base, oauth: helpers, authReq: bad, identity }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(400);
    }
    expect(completeAuthorization).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    // Control: the S256 request is granted.
    await completeNativeAuthorization({ ...base, oauth: helpers, authReq: authReq(['native']), identity });
    expect(completeAuthorization).toHaveBeenCalledTimes(1);
  });

  it('does not revoke the other grants of the member for the same client, so a second device keeps its session', async () => {
    const { helpers, completeAuthorization, revokeGrant } = oauth([{ id: 'g-first', createdAt: 1, metadata: { kind: 'native' } }]);
    await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: authReq(['native']),
      identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    });
    expect(completeAuthorization.mock.calls[0]?.[0].revokeExistingGrants).toBe(false);
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it('past the per-member cap, revokes the oldest native grants only and never an MCP grant', async () => {
    const native = Array.from({ length: NATIVE_GRANTS_PER_USER_MAX + 2 }, (_, i): FakeGrant => ({ id: `n${i}`, createdAt: 100 + i, metadata: { kind: 'native' } }));
    const mcp: FakeGrant = { id: 'mcp-old', createdAt: 1, metadata: { clientName: 'MCP' } };
    const { helpers, revokeGrant } = oauth([mcp, ...native.slice().reverse()]);
    await completeNativeAuthorization({
      ...base, oauth: helpers, authReq: authReq(['native']),
      identity: { userId: 'u1', tenantId: 't1', role: 'inspector' },
    });
    expect(revokeGrant.mock.calls.map((c) => c[0]).sort()).toEqual(['n0', 'n1']);
    expect(revokeGrant.mock.calls.every((c) => c[1] === 'u1')).toBe(true);
  });

  it('at the cap exactly, revokes nothing; a failing provider never undoes the grant', async () => {
    const atCap = Array.from({ length: NATIVE_GRANTS_PER_USER_MAX }, (_, i): FakeGrant => ({ id: `n${i}`, createdAt: i, metadata: { kind: 'native' } }));
    const a = oauth(atCap);
    await completeNativeAuthorization({ ...base, oauth: a.helpers, authReq: authReq(['native']), identity: { userId: 'u1', tenantId: 't1', role: 'inspector' } });
    expect(a.revokeGrant).not.toHaveBeenCalled();
    const broken = oauth();
    broken.listUserGrants.mockRejectedValue(new Error('kv down'));
    const redirectTo = await completeNativeAuthorization({ ...base, oauth: broken.helpers, authReq: authReq(['native']), identity: { userId: 'u1', tenantId: 't1', role: 'inspector' } });
    expect(redirectTo).toBe('io.example.app:/cb?code=abc');
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
