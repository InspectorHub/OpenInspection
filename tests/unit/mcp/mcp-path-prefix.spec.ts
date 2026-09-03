import { describe, it, expect } from 'vitest';
import { slugFromMcpPath, stripMcpSlugPrefix } from '../../../server/lib/mcp/identity-bridge';
import { STANDALONE_PROFILE, SAAS_PROFILE } from '../../../server/lib/deployment-profile';

describe('MCP paths live under /mcp/, never under /company/', () => {
    it('extracts the slug from /mcp/{slug}', () => {
        expect(slugFromMcpPath('/mcp/acme')).toBe('acme');
        expect(slugFromMcpPath('/mcp/acme/message')).toBe('acme');
        expect(slugFromMcpPath('/mcp/a%20b')).toBe('a b');
    });

    it('returns null for the bare standalone mount', () => {
        expect(slugFromMcpPath('/mcp')).toBeNull();
        expect(slugFromMcpPath('/mcp/')).toBeNull();
    });

    it('no longer recognises the retired /company/ shape', () => {
        expect(slugFromMcpPath('/company/acme/mcp')).toBeNull();
    });

    it('reduces /mcp/{slug}/… to the McpAgent mount path', () => {
        expect(stripMcpSlugPrefix('/mcp/acme')).toBe('/mcp');
        expect(stripMcpSlugPrefix('/mcp/acme/message')).toBe('/mcp/message');
        expect(stripMcpSlugPrefix('/mcp')).toBe('/mcp');
    });

    it('collapses mcpApiRoute to a single value in both profiles', () => {
        expect(STANDALONE_PROFILE.mcpApiRoute).toBe('/mcp');
        expect(SAAS_PROFILE.mcpApiRoute).toBe('/mcp');
    });
});
