import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

const writeAuditLog = vi.fn();
vi.mock('../../../server/lib/audit', () => ({ writeAuditLog: (p: unknown) => writeAuditLog(p) }));

import { isNativeAuthRequest, completeNativeAuthorization } from '../../../server/lib/auth/native-consent';

const authReq = (scope: string[]): AuthRequest => ({
  responseType: 'code', clientId: 'c1', redirectUri: 'io.example.app:/cb', scope, state: 's',
} as AuthRequest);

function oauth() {
  const completeAuthorization = vi.fn(async (_opts: { scope: string[]; props: Record<string, unknown> }) => ({ redirectTo: 'io.example.app:/cb?code=abc' }));
  return { helpers: { completeAuthorization } as unknown as OAuthHelpers, completeAuthorization };
}

const base = { db: {} as D1Database, clientName: 'Field App', ctx: undefined };

beforeEach(() => writeAuditLog.mockClear());

describe('isNativeAuthRequest', () => {
  it('is true only when native is among the requested scopes', () => {
    expect(isNativeAuthRequest(['native'])).toBe(true);
    expect(isNativeAuthRequest(['inspections:read'])).toBe(false);
    expect(isNativeAuthRequest(undefined)).toBe(false);
  });
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
