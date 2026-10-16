// buildMcpServer: one NEW server per call, shaped by the grant's scopes, with a
// bounded cache for the identity-free part of tool registration.
import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { buildMcpServer, toolDescriptorCacheSize } from '../../../server/lib/mcp/build-server';

const props = (scopes: string[]) => ({ userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes });
const noCtx = () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;

async function toolNames(scopes: string[]): Promise<string[]> {
    const server = await buildMcpServer({} as never, props(scopes), noCtx);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    // Strip the product prefix so 'inspection' below means the module, not the brand.
    const names = (await client.listTools()).tools.map((t) => t.name.replace(/^openinspection_/, ''));
    await client.close();
    return names;
}

describe('buildMcpServer', { timeout: 120_000 }, () => {
    it('returns a NEW server per call (a shared instance would leak one caller\'s tools into another)', async () => {
        const a = await buildMcpServer({} as never, props(['read:inspections']), noCtx);
        const b = await buildMcpServer({} as never, props(['read:inspections']), noCtx);
        expect(a).not.toBe(b);
    });

    it('offers only the tools the grant\'s scopes allow, and never an excluded one', async () => {
        // Through the protocol surface (client + in-memory transport), not a private field.
        const names = await toolNames(['read:inspections']);
        // Positive control: the grant does reach tools, and the tool set is not "everything".
        expect(names.length).toBeGreaterThan(0);
        expect(names.some((n) => /inspection/i.test(n))).toBe(true);
        expect(names.some((n) => /upload|sysadmin/i.test(n))).toBe(false);
        // A grant with no module scopes sees none of the module tools (only the always-on account tool).
        const bare = await toolNames([]);
        expect(bare.some((n) => /inspection/i.test(n))).toBe(false);
        expect(bare.length).toBeLessThan(names.length);
    });

    it('the descriptor cache does not change who sees what: a narrow grant after a wide one stays narrow', async () => {
        const wide = await toolNames(['read:inspections', 'write:inspections', 'read:contacts']);
        const narrow = await toolNames(['read:inspections']);
        expect(narrow.length).toBeLessThan(wide.length);
        expect(narrow.every((n) => wide.includes(n))).toBe(true);
    });

    it('keeps the descriptor cache bounded however many distinct scope sets arrive', async () => {
        for (let i = 0; i < 100; i++) {
            await buildMcpServer({} as never, props([`read:inspections`, `read:synthetic-${i}`]), noCtx);
        }
        const size = toolDescriptorCacheSize();
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThanOrEqual(64);
    });
});
