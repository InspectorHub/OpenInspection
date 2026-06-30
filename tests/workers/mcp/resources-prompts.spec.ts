// Phase E — Resources + Prompts wiring in the McpAgent, over a real MCP transport.
//
// `registerGrantedResources` / `registerGrantedPrompts` (extracted from
// InspectorMcp.init) are driven against a bare McpServer connected to an
// in-memory MCP Client, proving in the workerd runtime:
//   - resources/list + resources/templates/list expose the granted GETs,
//   - resources/read routes through the identity bridge and returns API JSON,
//   - prompts/list + prompts/get round-trip with scope gating + arg interpolation.
//
// callApiAsUser is stubbed (same rationale as tools-call.spec).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const bridge = vi.hoisted(() => ({
    calls: [] as Array<{ method: string; url: string }>,
    response: () =>
        new Response(JSON.stringify({ inspections: [{ id: 'i1' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }),
}));

vi.mock('../../../server/lib/mcp/identity-bridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/mcp/identity-bridge')>();
    return {
        ...actual,
        callApiAsUser: vi.fn(async (_env: unknown, _props: unknown, request: Request) => {
            bridge.calls.push({ method: request.method, url: request.url });
            return bridge.response();
        }),
    };
});

import {
    registerGrantedResources,
    type McpProps,
} from '../../../server/durable-objects/inspector-mcp';
import { registerGrantedPrompts } from '../../../server/lib/mcp/prompts';

const props = (scopes: string[]): McpProps => ({
    userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes,
});

async function connectedClient(scopes: string[]): Promise<Client> {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    await registerGrantedResources(
        server, {} as never, props(scopes),
        () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext,
    );
    registerGrantedPrompts(server, props(scopes));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
}

describe('MCP resources wiring (Phase E)', () => {
    beforeEach(() => { bridge.calls.length = 0; });

    it('lists the granted collection resource + get-by-id template', async () => {
        const client = await connectedClient(['read:inspections']);
        const staticUris = (await client.listResources()).resources.map((r) => r.uri);
        const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);

        expect(staticUris).toContain('openinspection:///api/inspections');
        expect(templates).toContain('openinspection:///api/inspections/{id}');
        // A non-granted tag is absent.
        expect(staticUris.some((u) => u.includes('invoice'))).toBe(false);
        await client.close();
    });

    it('reads a collection resource through the identity bridge', async () => {
        const client = await connectedClient(['read:inspections']);
        const res = await client.readResource({ uri: 'openinspection:///api/inspections' });

        expect(bridge.calls).toHaveLength(1);
        expect(bridge.calls[0].method).toBe('GET');
        expect(new URL(bridge.calls[0].url).pathname).toBe('/api/inspections');

        const contents = res.contents as Array<{ uri: string; text: string; mimeType?: string }>;
        expect(contents[0].mimeType).toBe('application/json');
        expect(JSON.parse(contents[0].text)).toMatchObject({ inspections: [{ id: 'i1' }] });
        await client.close();
    });

    it('substitutes the path param when reading a template resource', async () => {
        const client = await connectedClient(['read:inspections']);
        await client.readResource({ uri: 'openinspection:///api/inspections/abc123' });
        expect(new URL(bridge.calls[0].url).pathname).toBe('/api/inspections/abc123');
        await client.close();
    });
});

describe('MCP prompts wiring (Phase E)', () => {
    beforeEach(() => { bridge.calls.length = 0; });

    it('lists scope-gated prompts and gets one with interpolated args', async () => {
        const client = await connectedClient(['read:inspections']);
        const names = (await client.listPrompts()).prompts.map((p) => p.name);
        expect(names).toContain('summarize_inspection');
        expect(names).not.toContain('client_follow_up_email'); // needs read:contacts

        const got = await client.getPrompt({ name: 'summarize_inspection', arguments: { inspection_id: 'insp-7' } });
        const msg = got.messages[0].content as { type: string; text: string };
        expect(msg.type).toBe('text');
        expect(msg.text).toContain('insp-7');
        // Prompts make NO API calls — they only emit a guiding message.
        expect(bridge.calls).toHaveLength(0);
        await client.close();
    });
});
