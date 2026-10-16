import { OAuthError, OAuthProvider, getOAuthApi, type OAuthProviderOptions, type TokenExchangeCallbackResult } from '@cloudflare/workers-oauth-provider';
import { claimsNative, currentNativeRole, isNativeProps, nativeGrantCredentialState, nativeTokenExchange } from '../auth/native-token';
import type { McpProps } from './build-server';
import { resourceUrlFor } from './resource-url';
import { logger } from '../logger';
import { mcpEnabled, nativeClientEnabled, oauthProviderEnabled } from './flag';
import { assertCompanySlugMatches, slugFromMcpPath, stripMcpSlugPrefix } from './identity-bridge';
import { getDeploymentProfile, type ProfileEnv } from '../deployment-profile';
import type { AppEnv } from '../../types/hono';

/**
 * Loose fetch signature used for both the app handler and the returned handler.
 * The env generic is `any` so callers can pass the worker entry's local Env
 * without a cast — the OAuthProvider and Hono internally receive the real env.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchFn = (req: Request, env: any, ctx: ExecutionContext) => Response | Promise<Response>;

/**
 * Minimal env subset read by this module. The full wrangler bindings live in
 * worker-configuration.d.ts; regenerate with `wrangler types` once OAUTH_KV is
 * confirmed provisioned to update the global Env type.
 */
type McpFlagEnv = { MCP_ENABLED?: string; NATIVE_CLIENT_ENABLED?: string; APP_BASE_URL?: string; DB?: D1Database; TENANT_CACHE?: KVNamespace } & ProfileEnv;

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Paths this wrapper owns: the authorization server, its discovery documents, and the MCP endpoint. */
function isOAuthSurface(pathname: string): boolean {
    return pathname.startsWith('/oauth/') || pathname.startsWith('/.well-known/oauth-') || pathname === '/mcp' || pathname.startsWith('/mcp/');
}

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
    req?: Request,
): { fetch: FetchFn } {
    if (!oauthProviderEnabled(env)) return { fetch: appFetch };

    // Every token is bound to ONE canonical resource: the bare /mcp endpoint on
    // the deployment's own origin; /mcp/{slug} is a path under it. When no
    // trustworthy origin can be derived the OAuth surface is unavailable, but the
    // rest of the site must keep working: this wrapper is built on every request,
    // not only on /mcp.
    const resource = resourceUrlFor(env, req);
    if (!resource) {
        return {
            fetch: (r, e, ctx) => {
                if (!isOAuthSurface(new URL(r.url).pathname)) return appFetch(r, e, ctx);
                logger.error('OAuth surface unavailable: APP_BASE_URL is not an https (or loopback http) origin and none could be derived from the request');
                return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503, headers: JSON_HEADERS });
            },
        };
    }

    // A literal path prefix — every /mcp* request goes through token auth.
    // Slug validation (spec §6) is applied in the wrapper below.
    const apiRoute = getDeploymentProfile(env).mcpApiRoute; // always '/mcp'

    // One handler for both modes: the slug guard fires exactly when the PATH
    // carries a slug segment, not when the mode says it should. The standalone
    // request /mcp has no slug segment, so slugFromMcpPath returns null and the
    // request is delegated untouched — the two modes cannot drift (OI #308).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiHandler: any = {
        async fetch(
            req: Request,
            e: unknown,
            ctx: ExecutionContext & { props?: McpProps },
        ): Promise<Response> {
            // A native grant is a full session, not an MCP grant. It has no module
            // scopes, so it would reach the MCP server with nothing to call by
            // accident; refuse it outright instead of relying on that. Anything that
            // CLAIMS to be native is refused, well-formed or not.
            if (claimsNative(ctx.props)) {
                return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: JSON_HEADERS });
            }
            // The provider is also mounted for native clients alone. With MCP off
            // there is no MCP surface: answer as if /mcp were not mounted, even to
            // a token minted while it was on or obtained through the open
            // registration endpoint.
            if (!mcpEnabled(env)) {
                return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: JSON_HEADERS });
            }
            const url = new URL(req.url);
            const urlSlug = slugFromMcpPath(url.pathname);
            const props = ctx.props;
            if (urlSlug !== null && (!props || !assertCompanySlugMatches(urlSlug, props))) {
                return new Response(JSON.stringify({ error: 'tenant_mismatch' }), { status: 403, headers: JSON_HEADERS });
            }
            // A validated token always carries props. Refuse rather than let the
            // server factory fail on a missing scope list and surface as a 500.
            if (!props) {
                return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
            }
            // The handler's route is an exact match on /mcp, while the saas endpoint
            // is /mcp/{slug}: reduce it to the mount path. Tenant identity travels in
            // ctx.props (verified above), never in the URL.
            url.pathname = stripMcpSlugPrefix(url.pathname);
            // Dynamic: keeps the MCP server graph (SDK, tool catalogue) out of every
            // cold start, including requests on deployments where MCP is switched off.
            const { createInspectorMcpHandler } = await import('./handler');
            return createInspectorMcpHandler(env as unknown as AppEnv, props, req)(new Request(url, req), e, ctx);
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
        // The one canonical resource every token is bound to. Grants made against
        // the older per-workspace path are bound to that path and sign in again
        // (see docs/develop/conventions/mcp-migration-decisions.md). PKCE is S256
        // only in 1.x: plain was removed from the library, not merely switched off.
        resourceMetadata: { resource },
        // Deployment-wide: the provider accepts private-use-scheme redirect URIs
        // for every client. isRedirectAllowedForScope() is the per-scope check
        // (native clients, plus a short list of editors for MCP) and both the
        // authorize loader and action apply it.
        allowPrivateUseRedirectUris: true,
        // Native grants: 1h access token, a finite refresh lifetime at code
        // exchange, and a 90-day idle window re-armed on every refresh (see
        // nativeTokenExchange). MCP grants return undefined and keep the library
        // defaults. A denial revokes the grant, then throws OAuthError so the
        // client gets 400 invalid_grant; any other thrown error would surface as
        // a 500.
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
            const credentialState = await nativeGrantCredentialState(env, props);
            if (credentialState === 'changed') return refuse('Credentials changed since sign-in');
            // An unreadable marker is a storage fault, not evidence of a change: revoking here
            // would end a healthy grant over a blip. The provider documents OAuthError
            // 'temporarily_unavailable' as the retryable answer; a plain Error would surface as
            // an unstructured 500. Nothing is revoked or consumed, so the same refresh token works on retry.
            if (credentialState === 'unreadable') {
                throw new OAuthError('temporarily_unavailable', {
                    description: 'Credential check is temporarily unavailable; retry shortly',
                    statusCode: 503,
                    headers: { 'Retry-After': '30' },
                });
            }
            return { ...decision.result };
        },
    };
    const provider = new OAuthProvider<any>(options); // eslint-disable-line @typescript-eslint/no-explicit-any

    return { fetch: (req, e, ctx) => provider.fetch(req, e, ctx) };
}
