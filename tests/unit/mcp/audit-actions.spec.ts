import { describe, it, expect } from 'vitest';
import type { AuditAction } from '../../../server/lib/audit';

describe('MCP audit actions', () => {
  it('mcp.grant.created is a valid AuditAction', () => {
    const action: AuditAction = 'mcp.grant.created';
    expect(action).toBe('mcp.grant.created');
  });

  it('mcp.grant.revoked is a valid AuditAction', () => {
    const action: AuditAction = 'mcp.grant.revoked';
    expect(action).toBe('mcp.grant.revoked');
  });
});
