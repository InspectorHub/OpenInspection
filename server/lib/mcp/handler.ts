import { createMcpHandler } from 'agents/mcp/server';
import { buildMcpServer, type McpProps } from './build-server';
import { resourceUrlFor } from './resource-url';
import { localhostAllowedOrigins } from './sdk';
import type { AppEnv } from '../../types/hono';

/**
 * One handler per request, closed over the verified grant.
 *
 * The same endpoint serves both generations of the MCP wire protocol: a request
 * that carries its own protocol version and capabilities (2026-07-28) is served
 * statelessly, and a client that opens with `initialize` (2025-11-25 and
 * earlier) is served by a per-request legacy lane with no session, so GET and
 * DELETE answer 405 there.
 *
 * The factory runs on every MCP request and must return a NEW server each time:
 * a server shared between callers would answer one caller from another caller's
 * registrations.
 *
 * Only `oauth-provider.ts` imports this module, and only through a dynamic
 * `import()`, so a deployment with MCP switched off never evaluates it.
 */
export function createInspectorMcpHandler(env: AppEnv, props: McpProps, req: Request) {
    const resource = resourceUrlFor(env as { APP_BASE_URL?: string }, req);
    // The OAuth wrapper already refuses to reach here without a resource.
    const engineHost = resource ? new URL(resource).hostname : null;
    return createMcpHandler(() => buildMcpServer(env, props), {
        route: '/mcp',
        legacy: 'stateless',
        // An array REPLACES the handler's default allow-list (localhost and
        // workers.dev); it does not extend it. So the localhost set is spelled out
        // here and the engine's own host is added. Matching is by hostname only
        // (no port or scheme). A request with no Origin header is a non-browser
        // client and is always accepted.
        allowedOriginHostnames: engineHost ? [...localhostAllowedOrigins(), engineHost] : localhostAllowedOrigins(),
        authContext: { props },
    });
}
