import { OAuthError, OAuthProvider, getOAuthApi, type OAuthProviderOptions, type TokenExchangeCallbackResult } from '@cloudflare/workers-oauth-provider';
import { claimsNative, currentNativeRole, isNativeProps, nativeGrantPredatesCredentialChange, nativeTokenExchange } from '../auth/native-token';
import { InspectorMcp } from '../../durable-objects/inspector-mcp';
import type { McpProps } from '../../durable-objects/inspector-mcp';
import { mcpEnabled, nativeClientEnabled, oauthProviderEnabled } from './flag';
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
type McpFlagEnv = { MCP_ENABLED?: string; NATIVE_CLIENT_ENABLED?: string; DB?: D1Database; TENANT_CACHE?: KVNamespace } & ProfileEnv;

/**
 * Wraps `appFetch` with an OAuthProvider when MCP or native clients are enabled.
 * Returns `{ fetch: appFetch }` unchanged when both flags are off — the caller
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
    if (!oauthProviderEnabled(env)) return { fetch: appFetch };

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
            // A native grant is a full session, not an MCP grant. It has no module
            // scopes, so it would reach the MCP server with nothing to call by
            // accident; refuse it outright instead of relying on that. Anything that
            // CLAIMS to be native is refused, well-formed or not.
            if (claimsNative(ctx.props)) {
                return new Response(JSON.stringify({ error: 'forbidden' }), {
                    status: 403,
                    headers: { 'content-type': 'application/json' },
                });
            }
            // The provider is also mounted for native clients alone. With MCP off
            // there is no MCP surface: answer as if /mcp were not mounted, even to
            // a token minted while it was on or obtained through the open
            // registration endpoint.
            if (!mcpEnabled(env)) {
                return new Response(JSON.stringify({ error: 'not_found' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
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
    const options: OAuthProviderOptions<any> = {
        apiRoute,
        apiHandler,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultHandler: { fetch: appFetch } as any,
        authorizeEndpoint: '/oauth/authorize',
        tokenEndpoint: '/oauth/token',
        clientRegistrationEndpoint: '/oauth/register',
        // S256 only, and NOT the library default.
        //
        // Left unset, `allowPlainPKCE` defaults to true, and three things follow
        // that are all worse than they look:
        //
        //  - the metadata document advertises `["plain", "S256"]`, so a client
        //    is told plain is acceptable here
        //  - an authorize request that OMITS `code_challenge_method` is read as
        //    `plain` rather than refused, so the weaker method is what you get
        //    by saying nothing
        //  - the token endpoint's plain branch compares the verifier to the
        //    stored challenge verbatim, which is not a check: the challenge
        //    travelled in the same redirect URL as the code, so whoever
        //    intercepted one has the other
        //
        // PKCE exists to make a stolen authorization code unusable. `plain`
        // returns it to being usable, which makes advertising it worse than not
        // offering PKCE at all — a client that negotiates down believes it is
        // protected. Setting this to false both narrows the advertisement to
        // `["S256"]` and makes the parse REFUSE plain instead of accepting it.
        allowPlainPKCE: false,
        // Native grants: 1h access token, refresh token with no fixed expiry and
        // a sliding 90-day idle limit (see nativeTokenExchange). MCP grants
        // return undefined and keep the library defaults. A denial revokes the
        // grant, then throws OAuthError so the client gets 400 invalid_grant;
        // any other thrown error would surface as a 500.
        tokenExchangeCallback: async (opts): Promise<TokenExchangeCallbackResult | void> => {
            // Every refusal revokes the grant first, so a grant cannot outlive the
            // switch, the membership or the credential that allowed it, then
            // throws OAuthError so the client gets 400 invalid_grant; any other
            // thrown error would surface as a 500.
            const refuse = async (description: string): Promise<never> => {
                await getOAuthApi(options, env).revokeGrant(opts.grantId, opts.userId);
                throw new OAuthError('invalid_grant', { description });
            };
            const decision = nativeTokenExchange(opts.props, opts.grantType, Math.floor(Date.now() / 1000));
            if (!decision) {
                // Claims to be native but is not a valid native grant: never an MCP grant by default.
                if (claimsNative(opts.props)) return refuse('Native session cannot be verified');
                // An MCP grant on a deployment where MCP is off (native-only mounts the provider).
                if (!mcpEnabled(env)) return refuse('MCP is not enabled');
                return;
            }
            if (!nativeClientEnabled(env)) return refuse('Native clients are not enabled');
            if (decision.kind === 'deny') return refuse('Refresh token unused for too long');
            // Re-check the member on every exchange: a revocation that failed when
            // they were removed, or when their password changed, must not leave a
            // refresh token that keeps minting access tokens.
            const props = opts.props;
            if (!isNativeProps(props) || !env.DB) return refuse('Native session cannot be verified');
            if (!await currentNativeRole(env.DB, props.userId, props.tenantId)) return refuse('Member is no longer active');
            if (await nativeGrantPredatesCredentialChange(env, props)) return refuse('Credentials changed since sign-in');
            // The provider tests for the PRESENCE of `refreshTokenTTL` on a code exchange, so the
            // native result carries it as an explicit undefined (no fixed expiry). The library types
            // it as `number`, which `exactOptionalPropertyTypes` will not widen; Object.assign copies
            // the key, undefined value included, without an assertion.
            const result: TokenExchangeCallbackResult = {};
            Object.assign(result, decision.result);
            return result;
        },
    };
    const provider = new OAuthProvider<any>(options); // eslint-disable-line @typescript-eslint/no-explicit-any

    return { fetch: (req, e, ctx) => provider.fetch(req, e, ctx) };
}
