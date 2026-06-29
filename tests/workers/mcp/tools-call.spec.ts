// Task C4 — tools wiring in the McpAgent, exercised over a real MCP transport.
//
// `registerGrantedTools` (extracted from InspectorMcp.init) is driven against a
// bare McpServer connected to an in-memory MCP Client. This proves, in the
// workerd runtime:
//   - scope/tier/tag selection (read:inspections grants the inspections read
//     tools and nothing else),
//   - tools/list + tools/call protocol round-trips,
//   - the handler reconstructs the correct HTTP request (method + path + query)
//     and hands it to the identity bridge, returning the API response as text.
//
// The identity bridge (callApiAsUser) is stubbed to capture the request and
// return a canned response — the bridge's pure pieces (internalJwtPayload,
// assertCompanySlugMatches, companySlugFromMcpPath) are unit-tested in tests/unit/mcp/identity-bridge.spec.ts;
// its full JWT-signing + in-process-app dispatch needs a seeded D1 + keyring
// that belongs at the integration layer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const bridge = vi.hoisted(() => ({
    calls: [] as Array<{ method: string; url: string; body: string }>,
    response: () =>
        new Response(JSON.stringify({ inspections: [{ id: 'i1' }], cursor: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }),
}));

vi.mock('../../../server/lib/mcp/identity-bridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/mcp/identity-bridge')>();
    return {
        ...actual,
        callApiAsUser: vi.fn(async (_env: unknown, _props: unknown, request: Request) => {
            // NB: the stub bypasses signing, so there is no Authorization header to
            // assert here — that seam belongs to a real-bridge integration test.
            bridge.calls.push({
                method: request.method,
                url: request.url,
                body: await request.clone().text(),
            });
            return bridge.response();
        }),
    };
});

import { registerGrantedTools, type McpProps } from '../../../server/durable-objects/inspector-mcp';

const props = (scopes: string[]): McpProps => ({
    userId: 'u1',
    tenantId: 't1',
    tenantSlug: 'acme',
    role: 'admin',
    scopes,
});

async function connectedClient(grantScopes: string[]): Promise<Client> {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    await registerGrantedTools(
        server,
        {} as never,
        props(grantScopes),
        () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
}

describe('MCP tools wiring (C4)', () => {
    beforeEach(() => {
        bridge.calls.length = 0;
    });

    it('lists only the granted scope+tag+tier tools', async () => {
        const client = await connectedClient(['read:inspections']);
        const names = (await client.listTools()).tools.map((t) => t.name).sort();

        // Granted: the primary inspections READ tools.
        expect(names).toContain('openinspection_list_inspections');
        expect(names).toContain('openinspection_get_inspection');

        // Excluded: write tool on the same tag…
        expect(names).not.toContain('openinspection_create_inspection');
        expect(names).not.toContain('openinspection_patch_inspection');
        // …and read tools on a different tag the grant does not cover.
        expect(names.some((n) => n.includes('invoice'))).toBe(false);
        expect(names.some((n) => n.includes('contact'))).toBe(false);

        await client.close();
    });

    it('exposes an inputSchema with the query parameters', async () => {
        const client = await connectedClient(['read:inspections']);
        const tool = (await client.listTools()).tools.find((t) => t.name === 'openinspection_list_inspections');
        expect(tool).toBeDefined();
        const schema = tool!.inputSchema as { type?: string; properties?: Record<string, unknown> };
        expect(schema.type).toBe('object');
        expect(schema.properties).toHaveProperty('status');
        expect(schema.properties).toHaveProperty('limit');
        await client.close();
    });

    it('routes a read tool call through callApiAsUser and returns the API JSON', async () => {
        const client = await connectedClient(['read:inspections']);
        const result = await client.callTool({
            name: 'openinspection_list_inspections',
            arguments: { status: 'completed', limit: 5 },
        });

        // The handler reconstructed the correct HTTP request.
        expect(bridge.calls).toHaveLength(1);
        const call = bridge.calls[0];
        expect(call.method).toBe('GET');
        const url = new URL(call.url);
        expect(url.pathname).toBe('/api/inspections');
        expect(url.searchParams.get('status')).toBe('completed');
        expect(url.searchParams.get('limit')).toBe('5');
        expect(call.body).toBe(''); // GET carries no body

        // The API response is surfaced as the tool result text.
        const content = (result.content as Array<{ type: string; text: string }>);
        expect(content[0].type).toBe('text');
        expect(JSON.parse(content[0].text)).toMatchObject({ inspections: [{ id: 'i1' }] });
        expect(result.isError).toBeFalsy();

        await client.close();
    });

    it('marks a non-2xx API response as an error result', async () => {
        const prev = bridge.response;
        bridge.response = () => new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
        try {
            // `id` is a uuid-format path param — the generated input schema
            // enforces the format, so a well-formed id is required to reach the handler.
            const id = '550e8400-e29b-41d4-a716-446655440000';
            const client = await connectedClient(['read:inspections']);
            const result = await client.callTool({
                name: 'openinspection_get_inspection',
                arguments: { id },
            });
            // Path param was substituted into the URL.
            expect(new URL(bridge.calls[0].url).pathname).toBe(`/api/inspections/${id}`);
            expect(result.isError).toBe(true);
            await client.close();
        } finally {
            bridge.response = prev;
        }
    });
});
