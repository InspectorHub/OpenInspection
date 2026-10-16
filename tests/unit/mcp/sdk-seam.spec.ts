import { describe, it, expect } from 'vitest';
import * as seam from '../../../server/lib/mcp/sdk';

describe('MCP SDK seam', () => {
    it('exports exactly the names the rest of the code imports', () => {
        expect(typeof seam.McpServer).toBe('function');
        expect(typeof seam.ResourceTemplate).toBe('function');
        expect(typeof seam.ProtocolError).toBe('function');
        expect(seam.localhostAllowedOrigins()).toEqual(['localhost', '127.0.0.1', '[::1]']);
    });
    it('a missing resource is the InvalidParams protocol error (-32602)', () => {
        const err = new seam.ProtocolError(seam.ProtocolErrorCode.InvalidParams, 'Resource not found: x');
        expect(err.code).toBe(-32602);
    });
});
