/**
 * Stub for the `agents/mcp` module (Cloudflare Agents SDK) so tests running in
 * plain Node can resolve `server/durable-objects/inspector-mcp.ts`, which does
 * `import { McpAgent } from 'agents/mcp'`. The real `agents` package transitively
 * imports `cloudflare:email` / `cloudflare:workers` (Workers-runtime-only module
 * specifiers); since `agents` is an externalized dependency, Node's ESM loader
 * resolves those specifiers natively and throws "Received protocol 'cloudflare:'".
 *
 * Unit tests never instantiate `InspectorMcp` — they only need the `McpAgent`
 * base to resolve so the module (and the `McpProps` type it exports) loads.
 * Mirrors tests/unit/stubs/cloudflare-workers.ts. The real `agents/mcp` is used
 * by the Workers-runtime tests (tests/workers, vitest.workers.config.ts) and the
 * production build.
 */

export class McpAgent<Env = unknown, State = unknown, Props = unknown> {
    props?: Props;
    env!: Env;
    state?: State;

    static serve(_path: string, _opts?: unknown): { fetch: (...args: unknown[]) => Response } {
        return { fetch: () => new Response(null, { status: 501 }) };
    }

    async init(): Promise<void> {}
}
