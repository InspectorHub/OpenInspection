import { describe, it, expect } from 'vitest';
import { mcpEnabled } from '../../../server/lib/mcp/flag';

describe('mcpEnabled', () => {
  it('is false when unset', () => expect(mcpEnabled({})).toBe(false));
  it('is false for "false"/"0"', () => {
    expect(mcpEnabled({ MCP_ENABLED: 'false' })).toBe(false);
    expect(mcpEnabled({ MCP_ENABLED: '0' })).toBe(false);
  });
  it('is true for "true"/"1"', () => {
    expect(mcpEnabled({ MCP_ENABLED: 'true' })).toBe(true);
    expect(mcpEnabled({ MCP_ENABLED: '1' })).toBe(true);
  });
});
