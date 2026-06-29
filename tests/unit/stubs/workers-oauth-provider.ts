/**
 * Stub for `@cloudflare/workers-oauth-provider` so tests running in plain Node
 * can resolve `server/lib/mcp/oauth-provider.ts` (and anything importing it,
 * e.g. workers/app.ts). The real package's dist does
 * `import { WorkerEntrypoint } from "cloudflare:workers"` at module load — a
 * Workers-runtime-only specifier Node's ESM loader rejects. Aliasing the whole
 * package to this stub means the real one is never loaded in Node tests.
 *
 * Unit tests never exercise the OAuth flow (the MCP_ENABLED flag is off in the
 * standalone-404 path that imports workers/app); they only need `OAuthProvider`
 * to be constructable. The real provider runs in the Workers-runtime tests
 * (tests/workers/mcp/oauth-scaffold.spec.ts) and production.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class OAuthProvider<Env = unknown> {
    constructor(public readonly options?: unknown) {}
    fetch(_req: Request, _env?: Env, _ctx?: ExecutionContext): Promise<Response> {
        return Promise.resolve(new Response(null, { status: 501 }));
    }
}
