// The OpenAPI document is generated and walked once per isolate for MCP session
// registration, not once per session. `buildOpenApiDocument` is wrapped with a
// counter (the real function still runs); the module is re-imported per test so
// each starts with an empty cache.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';

const build = vi.hoisted(() => ({ calls: 0, failNext: false }));

vi.mock('../../../server/lib/openapi/build-document', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/openapi/build-document')>();
    return {
        ...actual,
        buildOpenApiDocument: ((app: never, config: never) => {
            build.calls++;
            if (build.failNext) {
                build.failNext = false;
                throw new Error('document build failed');
            }
            return actual.buildOpenApiDocument(app, config);
        }) as typeof actual.buildOpenApiDocument,
    };
});

const noCtx = () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;
const props = (scopes: string[]) => ({ userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'owner', scopes });

/** Broad grant: includes operations whose input references named component schemas. */
const WIDE = ['read:inspections', 'write:inspections', 'read:contacts', 'write:contacts', 'read:bookings', 'write:bookings'];

async function freshRegister() {
    vi.resetModules();
    const mod = await import('../../../server/lib/mcp/build-server');
    return (scopes: string[]) => mod.registerGrantedTools(new McpServer({ name: 't', version: '0' }), {} as never, props(scopes), noCtx);
}

describe('MCP component schemas are built once per isolate', { timeout: 120_000 }, () => {
    beforeEach(() => {
        build.calls = 0;
        build.failNext = false;
    });

    it('several session registrations build the OpenAPI document once', async () => {
        const register = await freshRegister();
        await register(WIDE);
        // Positive control: the grant did reach the document (a harness that never builds would pass `<= 1`).
        expect(build.calls).toBe(1);
        await register(WIDE);
        await register(WIDE);
        expect(build.calls).toBe(1);
    });

    it('a failed build is not cached: the next session retries and succeeds', async () => {
        const register = await freshRegister();
        build.failNext = true;
        await expect(register(WIDE)).rejects.toThrow('document build failed');
        expect(build.calls).toBe(1);
        await register(WIDE);
        expect(build.calls).toBe(2);
        await register(WIDE);
        expect(build.calls).toBe(2);
    });
});
