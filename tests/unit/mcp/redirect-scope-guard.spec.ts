import { describe, it, expect } from 'vitest';
import { isRedirectAllowedForScope } from '../../../server/lib/auth/native-consent';

const MCP = ['read:inspections'];
const NATIVE = ['native'];

describe('isRedirectAllowedForScope', () => {
    it('allows https for any scope', () => {
        expect(isRedirectAllowedForScope('https://client.example/cb', MCP)).toBe(true);
        expect(isRedirectAllowedForScope('https://client.example/cb', NATIVE)).toBe(true);
    });

    it('allows loopback http for any scope (RFC 8252 section 7.3)', () => {
        for (const uri of ['http://127.0.0.1:6274/callback', 'http://[::1]:6274/callback', 'http://localhost:6274/callback']) {
            expect(isRedirectAllowedForScope(uri, MCP), uri).toBe(true);
            expect(isRedirectAllowedForScope(uri, NATIVE), uri).toBe(true);
        }
    });

    it('refuses remote http for any scope', () => {
        expect(isRedirectAllowedForScope('http://client.example/cb', MCP)).toBe(false);
        expect(isRedirectAllowedForScope('http://192.168.1.5/cb', NATIVE)).toBe(false);
    });

    it('allows a reverse-domain private scheme only with the native scope', () => {
        expect(isRedirectAllowedForScope('io.example.app:/cb', NATIVE)).toBe(true);
        expect(isRedirectAllowedForScope('io.example.app:/cb', MCP)).toBe(false);
    });

    it('allows the known IDE schemes without the native scope', () => {
        for (const scheme of ['cursor', 'vscode', 'vscode-insiders', 'windsurf']) {
            expect(isRedirectAllowedForScope(`${scheme}://publisher.ext/oauth/callback`, MCP), scheme).toBe(true);
        }
        // A near-miss is not on the list.
        expect(isRedirectAllowedForScope('cursorx://publisher.ext/cb', MCP)).toBe(false);
    });

    it('refuses active-content and non-callback schemes for every scope', () => {
        for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'mailto:a@b.c', 'blob:https://x/y', 'not a uri']) {
            expect(isRedirectAllowedForScope(uri, MCP), uri).toBe(false);
            expect(isRedirectAllowedForScope(uri, NATIVE), uri).toBe(false);
        }
    });

    it('refuses embedded credentials', () => {
        expect(isRedirectAllowedForScope('https://user:pw@client.example/cb', MCP)).toBe(false);
    });
});
