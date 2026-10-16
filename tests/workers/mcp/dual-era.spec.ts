// One endpoint, two protocol eras: the handler the OAuth wrapper delegates to is
// driven directly (the wrapper itself is covered in native-authorize.spec.ts).
import { describe, it, expect } from 'vitest';
import { createInspectorMcpHandler } from '../../../server/lib/mcp/handler';

const props = { userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes: ['read:inspections'] };
const env = { MCP_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
    });
const handler = () => createInspectorMcpHandler(env, props, new Request('https://app.example.com/mcp'));

/** A body that is plain JSON or an SSE stream of `data:` frames, as the JSON-RPC messages it carries. */
async function messages(res: Response): Promise<Array<Record<string, unknown>>> {
    const text = await res.text();
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return [JSON.parse(text)];
    return text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()));
}

const modern = (method: string, extra: Record<string, unknown> = {}) => ({
    jsonrpc: '2.0', id: 1, method,
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }, ...extra },
});
const modernHeaders = (method: string) => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': method });

describe('one endpoint, two protocol eras', { timeout: 120_000 }, () => {
    it('serves a 2026-07-28 request that carries its own version and capabilities', async () => {
        const res = await handler()(post(modern('tools/list'), modernHeaders('tools/list')), env, ctx);
        expect(res.status).toBe(200);
        const [msg] = await messages(res);
        const tools = (msg?.result as { tools: Array<{ name: string }> }).tools;
        expect(tools.length).toBeGreaterThan(0);
    });

    it('still serves a 2025-11-25 client: initialize, then tools/list with no session header', async () => {
        const init = await handler()(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
            protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '0' } } }), env, ctx);
        expect(init.status).toBe(200);
        const [initMsg] = await messages(init);
        expect((initMsg?.result as { protocolVersion?: string }).protocolVersion).toBeTruthy();
        // No Mcp-Session-Id is issued: the legacy lane keeps no session.
        expect(init.headers.get('mcp-session-id')).toBeNull();

        const list = await handler()(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), env, ctx);
        expect(list.status).toBe(200);
        const [listMsg] = await messages(list);
        expect((listMsg?.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
    });

    it('answers GET and DELETE with 405 (no standalone stream, no sessions)', async () => {
        for (const method of ['GET', 'DELETE']) {
            const res = await handler()(new Request('https://app.example.com/mcp', { method }), env, ctx);
            expect(res.status, method).toBe(405);
        }
    });

    it('rejects a header that disagrees with the body (Mcp-Method mismatch)', async () => {
        const res = await handler()(post(modern('tools/list'), modernHeaders('resources/list')), env, ctx);
        expect(res.status).toBe(400);
        // Control: the matching header is accepted.
        const ok = await handler()(post(modern('tools/list'), modernHeaders('tools/list')), env, ctx);
        expect(ok.status).toBe(200);
    });

    it('offers only what the grant allows, in both eras', async () => {
        const names = async (res: Response) => ((await messages(res))[0]?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
        const modernNames = await names(await handler()(post(modern('tools/list'), modernHeaders('tools/list')), env, ctx));
        const legacyNames = await names(await handler()(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), env, ctx));
        expect(modernNames.sort()).toEqual(legacyNames.sort());
        expect(modernNames.some((n) => /upload|sysadmin/i.test(n))).toBe(false);
    });
});
