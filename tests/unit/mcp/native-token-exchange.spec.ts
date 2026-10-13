import { describe, it, expect } from 'vitest';
import { nativeTokenExchange, NATIVE_IDLE_LIMIT_S, type NativeProps } from '../../../server/lib/auth/native-token';

const NOW = 1_800_000_000;
const props = (lastUsedAt: number): NativeProps => ({ kind: 'native', userId: 'u', tenantId: 't', role: 'inspector', lastUsedAt });

describe('nativeTokenExchange', () => {
  it('code exchange: 1h access, refresh token without fixed expiry, stamps lastUsedAt', () => {
    const d = nativeTokenExchange(props(0), 'authorization_code', NOW);
    expect(d).toEqual({ kind: 'allow', result: { accessTokenTTL: 3600, refreshTokenTTL: undefined, newProps: props(NOW) } });
    // Present-but-undefined is what disables the provider's 30-day default.
    expect(d?.kind === 'allow' && 'refreshTokenTTL' in d.result).toBe(true);
  });

  it('refresh within the idle limit: allowed and slides lastUsedAt forward', () => {
    const d = nativeTokenExchange(props(NOW - NATIVE_IDLE_LIMIT_S + 60), 'refresh_token', NOW);
    expect(d).toEqual({ kind: 'allow', result: { accessTokenTTL: 3600, newProps: props(NOW) } });
    // The provider rejects refreshTokenTTL on a refresh, even when undefined.
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
