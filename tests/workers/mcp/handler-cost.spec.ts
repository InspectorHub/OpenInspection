// Per-request cost of the MCP handler, measured in workerd.
//
// The handler builds a fresh server for every request (never shared between
// callers), so `tools/list` and every `tools/call` pay for registration again,
// and a 2025-11-25 client's handshake pays for it up to three times
// (`initialize`, `notifications/initialized`, `tools/list`). The identity-free
// part of that work (selecting tools by scope, folding parameters into a schema,
// building the zod schema) is cached per scope set; what is left is measured here
// so a change that makes a request noticeably dearer fails a test instead of
// showing up as 1102s on a plan with a 10 ms CPU budget.
//
// Method: one discarded warm-up request, then ROUNDS timed rounds. Median, min
// and max are all printed (a minimum alone is a lower bound, not the cost) and
// the assertion is on the median. Numbers are wall milliseconds from the
// in-isolate clock, which advances across async work; they include the in-memory
// transport and JSON encoding, not network. Measured on a developer machine
// (workerd, warm); see the ceilings below.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../server/lib/mcp/identity-bridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/mcp/identity-bridge')>();
    return {
        ...actual,
        callApiAsUser: vi.fn(async () => new Response(JSON.stringify({ inspections: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
    };
});

import { createInspectorMcpHandler } from '../../../server/lib/mcp/handler';

const ROUNDS = 15;
const props = { userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes: ['read:inspections', 'read:contacts'] };
const env = { MCP_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
    });
const serve = (req: Request) => createInspectorMcpHandler(env, props, new Request('https://app.example.com/mcp'))(req, env, ctx);

const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const modernList = () => post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' });
const modernCall = () => post(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'openinspection_list_inspections', arguments: {}, _meta: meta } },
    { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'openinspection_list_inspections' },
);
const legacyHandshake = async () => {
    const init = await serve(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'c', version: '0' } } }));
    await init.text();
    const note = await serve(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    await note.text();
    const list = await serve(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    await list.text();
};

async function measure(label: string, run: () => Promise<void>): Promise<number> {
    await run(); // warm-up, discarded
    const samples: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
        const t0 = Date.now();
        await run();
        samples.push(Date.now() - t0);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    // eslint-disable-next-line no-console
    console.log(`[mcp-cost] ${label}: median ${median}ms, min ${sorted[0]}ms, max ${sorted[sorted.length - 1]}ms, rounds [${samples.join(',')}]`);
    return median;
}

// Ceilings. Measured medians when written (wall ms, busy shared machine, rounds
// varied 9-163 ms): tools/list 15, tools/call 16, legacy handshake 59. The server
// build alone is ~3 ms of that (see build-cost.spec.ts); the rest is the handler,
// transport and JSON. Ceilings are about 2x the medians because single rounds are
// that noisy; they catch a regression, they do not certify a CPU budget.
const CEILING_MS = { list: 30, call: 32, handshake: 120 };

describe('MCP handler per-request cost (workerd)', { timeout: 300_000 }, () => {
    it('the first request in a fresh isolate (cold) is recorded', async () => {
        const t0 = Date.now();
        const res = await serve(modernList());
        await res.text();
        // eslint-disable-next-line no-console
        console.log(`[mcp-cost] first request in this isolate (cold): ${Date.now() - t0}ms`);
        expect(res.status).toBe(200);
    });

    it('a hot tools/list stays within its ceiling', async () => {
        const median = await measure('hot tools/list', async () => { await (await serve(modernList())).text(); });
        expect(median).toBeLessThanOrEqual(CEILING_MS.list);
    });

    it('a hot tools/call stays within its ceiling', async () => {
        const median = await measure('hot tools/call', async () => {
            const res = await serve(modernCall());
            const text = await res.text();
            expect(res.status, text).toBe(200);
        });
        expect(median).toBeLessThanOrEqual(CEILING_MS.call);
    });

    it('a whole 2025-11-25 handshake (three factory calls) stays within its ceiling', async () => {
        const median = await measure('hot legacy handshake (initialize + initialized + tools/list)', legacyHandshake);
        expect(median).toBeLessThanOrEqual(CEILING_MS.handshake);
    });
});
