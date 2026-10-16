// Browser-origin policy of the MCP handler. Every refusal is paired, in this
// file, with an acceptance, so a handler that rejected everything would fail.
import { describe, it, expect } from 'vitest';
import { createInspectorMcpHandler } from '../../../server/lib/mcp/handler';

const props = { userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes: ['read:inspections'] };
const env = { MCP_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const listTools = (origin?: string) =>
    new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(origin ? { origin } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
const call = (origin?: string) =>
    createInspectorMcpHandler(env, props, new Request('https://app.example.com/mcp'))(listTools(origin), env, ctx);

describe('MCP handler browser-origin policy', { timeout: 120_000 }, () => {
    it('accepts a request with no Origin (a non-browser client)', async () => {
        expect((await call()).status).toBe(200);
    });
    it("accepts the engine's own origin", async () => {
        expect((await call('https://app.example.com')).status).toBe(200);
    });
    it('accepts a loopback origin (a browser MCP inspector on localhost)', async () => {
        expect((await call('http://localhost:6274')).status).toBe(200);
        expect((await call('http://127.0.0.1:6274')).status).toBe(200);
    });
    it("refuses a stranger's origin", async () => {
        expect((await call('https://evil.example.net')).status).toBe(403);
    });
});
