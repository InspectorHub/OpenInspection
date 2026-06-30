import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { InspectorMcp } from '../../durable-objects/inspector-mcp';
import type { McpProps } from '../../durable-objects/inspector-mcp';
import { mcpEnabled } from './flag';
import { assertCompanySlugMatches, companySlugFromMcpPath, stripCompanyPrefix } from './identity-bridge';

/**
 * Loose fetch signature used for both the app handler and the returned handler.
 * The env generic is `any` so callers can pass the worker entry's local Env
 * without a cast — the OAuthProvider and Hono internally receive the real env.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchFn = (req: Request, env: any, ctx: ExecutionContext) => Response | Promise<Response>;

/**
 * Minimal env subset read by this module. The full wrangler bindings live in
 * worker-configuration.d.ts; regenerate with `wrangler types` once OAUTH_KV /
 * INSPECTOR_MCP are confirmed provisioned to update the global Env type.
 */
type McpFlagEnv = { MCP_ENABLED?: string; APP_MODE?: string };

/**
 * Wraps `appFetch` with an OAuthProvider when the MCP_ENABLED flag is set.
 * Returns `{ fetch: appFetch }` unchanged when the flag is off — the caller
 * is unaffected and the OAuth surface is not mounted at all.
 *
 * apiRoute strategy (docs/developers/mcp-oauth-notes.md §4 / §11.3):
 *   - standalone: '/mcp'        — single fixed endpoint
 *   - saas:       '/company/'   — broad literal prefix; per-workspace /company/{slug}/mcp
 *
 * '/company/' is collision-free today — no existing /company/* routes; existing
 * slug routes are /book/ /inspector/ /portal/ /report/ /sign/ /observe/.
 * Re-verify before adding any new /company/* route — OAuthProvider treats every
 * /company/* request as an authenticated API call when this flag is on. The
 * segment is the full word `company` (not an abbreviation) per the project
 * URL-clarity rule and aligns with product terminology (Company).
 */
export function buildOAuthHandler(
    appFetch: FetchFn,
    env: McpFlagEnv,
): { fetch: FetchFn } {
    if (!mcpEnabled(env)) return { fetch: appFetch };

    // '/company/' is a broad literal prefix — all /company/* requests go through
    // token auth. Slug validation (spec §6) is applied in the saas wrapper below.
    const apiRoute = env.APP_MODE === 'saas' ? '/company/' : '/mcp';

    // McpAgent.serve() internal path is always '/mcp'; 'INSPECTOR_MCP' overrides
    // McpAgent's default MCP_OBJECT binding name (see wrangler.jsonc DO bindings).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseServeHandler = InspectorMcp.serve('/mcp', { binding: 'INSPECTOR_MCP' }) as any;

    // Saas only: wrap with spec §6 slug guard. Standalone path is byte-identical
    // (no /company/ prefix, so companySlugFromMcpPath always returns null there).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiHandler: any = env.APP_MODE === 'saas'
        ? {
            fetch(
                req: Request,
                e: unknown,
                ctx: ExecutionContext & { props?: McpProps },
            ): Response | Promise<Response> {
                const url = new URL(req.url);
                const urlSlug = companySlugFromMcpPath(url.pathname);
                if (urlSlug !== null) {
                    const props = ctx.props;
                    if (!props || !assertCompanySlugMatches(urlSlug, props)) {
                        return new Response(JSON.stringify({ error: 'tenant_mismatch' }), {
                            status: 403,
                            headers: { 'content-type': 'application/json' },
                        });
                    }
                    // McpAgent.serve('/mcp') matches the literal mount path via
                    // URLPattern; the saas endpoint is /company/{slug}/mcp, which
                    // would never match and 404s ("Not found"). Strip the
                    // /company/{slug} prefix so the agent sees its mount path.
                    // Tenant identity travels in ctx.props (verified above), and
                    // the DO instance is keyed by session id — not the URL — so
                    // this rewrite preserves tenant isolation.
                    url.pathname = stripCompanyPrefix(url.pathname);
                    return baseServeHandler.fetch(new Request(url, req), e, ctx);
                }
                return baseServeHandler.fetch(req, e, ctx);
            },
        }
        : baseServeHandler;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new OAuthProvider<any>({
        apiRoute,
        apiHandler,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultHandler: { fetch: appFetch } as any,
        authorizeEndpoint: '/oauth/authorize',
        tokenEndpoint: '/oauth/token',
        clientRegistrationEndpoint: '/oauth/register',
    });

    return { fetch: (req, e, ctx) => provider.fetch(req, e, ctx) };
}
