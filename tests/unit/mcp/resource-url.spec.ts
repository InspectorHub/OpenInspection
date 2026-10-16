import { describe, it, expect } from 'vitest';
import { resourceUrlFor } from '../../../server/lib/mcp/resource-url';

describe('resource URL', () => {
    it('is the bare /mcp endpoint on the configured origin', () => {
        expect(resourceUrlFor({ APP_BASE_URL: 'https://app.example.com/' })).toBe('https://app.example.com/mcp');
    });
    it('falls back to the request origin when APP_BASE_URL is unset', () => {
        expect(resourceUrlFor({}, new Request('https://eng.example.com/mcp/acme'))).toBe('https://eng.example.com/mcp');
    });
    it('prefers the configured origin over the request origin', () => {
        expect(resourceUrlFor({ APP_BASE_URL: 'https://app.example.com' }, new Request('https://other.example.net/mcp'))).toBe('https://app.example.com/mcp');
    });
    it('allows a loopback http origin', () => {
        expect(resourceUrlFor({ APP_BASE_URL: 'http://127.0.0.1:8789' })).toBe('http://127.0.0.1:8789/mcp');
        expect(resourceUrlFor({ APP_BASE_URL: 'http://localhost:8787' })).toBe('http://localhost:8787/mcp');
    });
    it('returns null, not a throw, for a non-https non-loopback origin or no origin at all', () => {
        expect(resourceUrlFor({ APP_BASE_URL: 'http://192.168.1.5:8787' })).toBeNull();
        expect(resourceUrlFor({})).toBeNull();
        expect(resourceUrlFor({ APP_BASE_URL: 'not a url' })).toBeNull();
    });
});
