import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { InspectorMcp } from '../../durable-objects/inspector-mcp';
import type { McpProps } from '../../durable-objects/inspector-mcp';
import { mcpEnabled } from './flag';
import { assertCompanySlugMatches, slugFromMcpPath, stripMcpSlugPrefix } from './identity-bridge';
import { getDeploymentProfile, type ProfileEnv } from '../deployment-profile';

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
type McpFlagEnv = { MCP_ENABLED?: string } & ProfileEnv;

/**
 * Wraps `appFetch` with an OAuthProvider when the MCP_ENABLED flag is set.
 * Returns `{ fetch: appFetch }` unchanged when the flag is off — the caller
 * is unaffected and the OAuth surface is not mounted at all.
 *
 * apiRoute strategy (docs/develop/conventions/mcp-oauth-notes.md §4 / §11.3), read from
 * profile.mcpApiRoute, which is always '/mcp':
 *   - standalone: the single fixed endpoint /mcp
 *   - saas:       per-workspace /mcp/{slug} under the same prefix
 *
 * OAuthProvider matches apiRoute as a literal path PREFIX, so one value covers
 * both shapes. The saas mount used to be the broad '/company/' prefix, which
 * made OAuthProvider treat every /company/* request as an authenticated API
 * call — it held the whole namespace hostage to a "do not add a /company/*
 * route" rule written in a file nobody reads. That namespace is now released;
 * this engine claims nothing under /company/.
 */
export function buildOAuthHandler(
    appFetch: FetchFn,
    env: McpFlagEnv,
): { fetch: FetchFn } {
    if (!mcpEnabled(env)) return { fetch: appFetch };

    // A literal path prefix — every /mcp* request goes through token auth.
    // Slug validation (spec §6) is applied in the wrapper below.
    const apiRoute = getDeploymentProfile(env).mcpApiRoute; // always '/mcp'

    // McpAgent.serve() internal path is always '/mcp'; 'INSPECTOR_MCP' overrides
    // McpAgent's default MCP_OBJECT binding name (see wrangler.jsonc DO bindings).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseServeHandler = InspectorMcp.serve('/mcp', { binding: 'INSPECTOR_MCP' }) as any;

    // One handler for both modes: the slug guard fires exactly when the PATH
    // carries a slug segment, not when the mode says it should. The standalone
    // request /mcp has no slug segment, so slugFromMcpPath returns null and the
    // request is delegated untouched — the two modes cannot drift (OI #308).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiHandler: any = {
        fetch(
            req: Request,
            e: unknown,
            ctx: ExecutionContext & { props?: McpProps },
        ): Response | Promise<Response> {
            const url = new URL(req.url);
            const urlSlug = slugFromMcpPath(url.pathname);
            if (urlSlug === null) return baseServeHandler.fetch(req, e, ctx);
            const props = ctx.props;
            if (!props || !assertCompanySlugMatches(urlSlug, props)) {
                return new Response(JSON.stringify({ error: 'tenant_mismatch' }), {
                    status: 403,
                    headers: { 'content-type': 'application/json' },
                });
            }
            // McpAgent.serve('/mcp') matches the literal mount path via
            // URLPattern; the saas endpoint is /mcp/{slug}, which would never
            // match and 404s ("Not found"). Reduce it to the mount path so the
            // agent sees what it registered. Tenant identity travels in
            // ctx.props (verified above), and the DO instance is keyed by
            // session id — not the URL — so this rewrite preserves isolation.
            url.pathname = stripMcpSlugPrefix(url.pathname);
            return baseServeHandler.fetch(new Request(url, req), e, ctx);
        },
    };

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
