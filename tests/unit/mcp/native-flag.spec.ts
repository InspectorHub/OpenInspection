import { describe, it, expect } from 'vitest';
import { nativeClientEnabled, oauthProviderEnabled } from '../../../server/lib/mcp/flag';

describe('native client flag', () => {
  it('is off unless explicitly enabled', () => {
    expect(nativeClientEnabled({})).toBe(false);
    expect(nativeClientEnabled({ NATIVE_CLIENT_ENABLED: 'true' })).toBe(true);
    expect(nativeClientEnabled({ NATIVE_CLIENT_ENABLED: '0' })).toBe(false);
  });
  it('mounts the OAuth provider when either MCP or native clients are enabled', () => {
    expect(oauthProviderEnabled({})).toBe(false);
    expect(oauthProviderEnabled({ MCP_ENABLED: '1' })).toBe(true);
    expect(oauthProviderEnabled({ NATIVE_CLIENT_ENABLED: '1' })).toBe(true);
  });
});
