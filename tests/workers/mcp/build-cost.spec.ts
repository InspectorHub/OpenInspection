// Server construction alone (no transport): registration of a small grant after the descriptor cache is warm.
import { describe, it, expect } from 'vitest';
import { buildMcpServer } from '../../../server/lib/mcp/build-server';

const props = { userId: 'u1', tenantId: 't1', tenantSlug: 'acme', role: 'admin', scopes: ['read:inspections', 'read:contacts'] };
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;

describe('buildMcpServer hot cost', { timeout: 300_000 }, () => {
    it('median wall time of a hot build stays small (measured ~3ms)', async () => {
        await buildMcpServer({} as never, props, ctx);
        const samples: number[] = [];
        for (let i = 0; i < 30; i++) {
            const t = Date.now();
            await buildMcpServer({} as never, props, ctx);
            samples.push(Date.now() - t);
        }
        const median = [...samples].sort((a, b) => a - b)[15]!;
        expect(median).toBeLessThanOrEqual(10);
    });
});
