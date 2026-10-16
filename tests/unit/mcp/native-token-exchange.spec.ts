import { describe, it, expect } from 'vitest';
import { nativeTokenExchange, NATIVE_IDLE_LIMIT_S, NATIVE_REFRESH_MAX_TTL_S, type NativeProps } from '../../../server/lib/auth/native-token';

const NOW = 1_800_000_000;
const props = (lastUsedAt: number): NativeProps => ({ kind: 'native', userId: 'u', tenantId: 't', role: 'inspector', lastUsedAt, grantedAt: 1_700_000_000 });

describe('nativeTokenExchange', () => {
  it('code exchange: 1h access, a finite refresh lifetime, stamps lastUsedAt', () => {
    const d = nativeTokenExchange(props(0), 'authorization_code', NOW);
    expect(d).toEqual({ kind: 'allow', result: { accessTokenTTL: 3600, refreshTokenTTL: NATIVE_REFRESH_MAX_TTL_S, newProps: props(NOW) } });
    // refreshTokenIdleTTL is read by the provider at refresh time only; offering it here would be ignored.
    expect(d?.kind === 'allow' && 'refreshTokenIdleTTL' in d.result).toBe(false);
    // The lifetime is finite and longer than the idle limit, so the idle check is what ends a quiet grant.
    expect(Number.isFinite(NATIVE_REFRESH_MAX_TTL_S)).toBe(true);
    expect(NATIVE_REFRESH_MAX_TTL_S).toBeGreaterThan(NATIVE_IDLE_LIMIT_S);
  });

  it('refresh within the idle limit: allowed, slides lastUsedAt forward and re-arms the idle window', () => {
    const d = nativeTokenExchange(props(NOW - NATIVE_IDLE_LIMIT_S + 60), 'refresh_token', NOW);
    expect(d).toEqual({ kind: 'allow', result: { accessTokenTTL: 3600, refreshTokenIdleTTL: NATIVE_IDLE_LIMIT_S, newProps: props(NOW) } });
    // The provider applies refreshTokenTTL at code exchange only; on a refresh it must not be sent.
    expect(d?.kind === 'allow' && 'refreshTokenTTL' in d.result).toBe(false);
  });

  it('refresh exactly at the idle limit is still allowed (boundary), one second past is denied', () => {
    expect(nativeTokenExchange(props(NOW - NATIVE_IDLE_LIMIT_S), 'refresh_token', NOW)?.kind).toBe('allow');
    expect(nativeTokenExchange(props(NOW - NATIVE_IDLE_LIMIT_S - 1), 'refresh_token', NOW)).toEqual({ kind: 'deny' });
  });

  it('MCP grants stay on library defaults', () => {
    expect(nativeTokenExchange({ userId: 'u', scopes: [] }, 'refresh_token', NOW)).toBeUndefined();
  });
});
