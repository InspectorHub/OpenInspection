// The MCP server graph (SDK, tool catalogue, the handler) must stay out of every
// cold start: the OAuth wrapper is built on every request, including on
// deployments where MCP is switched off. A past incident (a self-hoster hitting
// Cloudflare error 1102 on ordinary pages) came from exactly this graph being
// reachable from the entry module, so the handler is only ever reached through a
// dynamic import inside the authenticated MCP path.
import { describe, it, expect, vi } from 'vitest';

const evaluated = vi.hoisted(() => ({ handlerModule: 0 }));

// The factory runs when the module is first imported, so the counter says whether it was.
vi.mock('../../../server/lib/mcp/handler', async (importOriginal) => {
    evaluated.handlerModule++;
    return importOriginal<typeof import('../../../server/lib/mcp/handler')>();
});

import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('the MCP handler module is loaded lazily', { timeout: 120_000 }, () => {
    it('is not evaluated by building the wrapper or serving unauthenticated and non-MCP requests; importing it does evaluate it (control)', async () => {
        const nativeOnly = { NATIVE_CLIENT_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' };
        const mcpOn = { MCP_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' };
        const off = { APP_BASE_URL: 'https://app.example.com' };
        const app = vi.fn(async () => new Response('page'));
        for (const env of [off, nativeOnly, mcpOn]) {
            for (const path of ['/', '/mcp']) {
                const req = new Request(`https://app.example.com${path}`);
                await buildOAuthHandler(app, env, req).fetch(req, env, ctx);
            }
        }
        expect(evaluated.handlerModule, 'no request without a token reaches the handler').toBe(0);

        // Control: the counter does move when the module is imported.
        await import('../../../server/lib/mcp/handler');
        expect(evaluated.handlerModule).toBe(1);
    });
});
