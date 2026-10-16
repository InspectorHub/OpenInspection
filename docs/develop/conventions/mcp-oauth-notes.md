<!-- no-portal-routes-allow-file: every remaining `/company/` here is a NEGATIVE statement — the SaaS MCP mount used to be `apiRoute: '/company/'` and no longer is. They are kept because the reason that prefix was wrong is the reason nobody should reach for it again; none of them is a link to a hosted screen, and this engine now claims nothing under `/company/*`. -->

# MCP Remote + OAuth Integration — Discovery Notes

> First written as a spike (2026-06-29) and rewritten for the stateless handler and
> OAuth provider 1.x. Code depends on the exact symbol names recorded here; update
> this file if a package version bump changes the API surface. The reasoning behind
> the current design is in [`mcp-migration-decisions.md`](mcp-migration-decisions.md).

---

## 1. Resolved package versions

| Package | Version | Notes |
|---|---|---|
| `@cloudflare/workers-oauth-provider` | **1.2.3** | pinned exactly |
| `agents` | **0.28.0** | pinned exactly; only `agents/mcp/server` is imported |
| `@modelcontextprotocol/server` | **2.0.0** | pinned exactly; imported only through `server/lib/mcp/sdk.ts` |
| `@modelcontextprotocol/client` | **2.0.0** | pinned exactly; used by tests |
| `zod` (project) | **4.4.3** | a single copy is shared with the MCP packages |

The v1 `@modelcontextprotocol/sdk` package is no longer a dependency. `agents` still
declares it as a peer for its other entry points, which this codebase does not
import; the repository's `.npmrc` sets `legacy-peer-deps=true`, so the unmet peer is
not reported. The check is `npm ls`: it must show no `invalid` or `missing` line.

---

## 2. OAuthProvider configuration surface

Import path: `import { OAuthProvider, OAuthHelpers } from '@cloudflare/workers-oauth-provider'`

### Constructor options (`OAuthProviderOptions<Env>`)

All fields are on `OAuthProviderOptions<Env>`:

| Option | Type | Required | Notes |
|---|---|---|---|
| `apiRoute` | `string \| string[]` | exclusive with `apiHandlers` | Literal prefix match(es); no pattern/glob support |
| `apiHandler` | `ExportedHandler \| WorkerEntrypoint class` | with `apiRoute` | Single-handler config |
| `apiHandlers` | `Record<string, handler>` | exclusive with `apiRoute`+`apiHandler` | Multi-handler: route → handler map |
| `defaultHandler` | `ExportedHandler \| WorkerEntrypoint class` | **required** | Handles non-API and unauthenticated requests |
| `authorizeEndpoint` | `string` | **required** | Path or URL of the consent UI (not implemented by the provider) |
| `tokenEndpoint` | `string` | **required** | Provider implements this endpoint |
| `clientRegistrationEndpoint` | `string` | optional | Provider implements RFC 7591 DCR here |
| `scopesSupported` | `string[]` | optional | Included as `scopes_supported` in RFC 8414 metadata |
| `accessTokenTTL` | `number` | optional | Seconds; default 3600 |
| `refreshTokenTTL` | `number` | optional | Seconds; default 2,592,000 (30 days); `0` issues no refresh token. A callback result's `refreshTokenTTL` applies at code exchange only; `undefined` there keeps the provider value, it never means "no expiry". |
| `clientRegistrationTTL` | `number` | optional | Seconds; default 7,776,000 (90 days) |
| `allowImplicitFlow` | — | removed | Removed in 1.x. Setting it to `true` throws at construction. |
| `allowPrivateUseRedirectUris` | `boolean` | optional | Default false. Deployment-wide; we set it `true` and apply a per-scope policy ourselves (see below). |
| `allowPlainPKCE` | — | removed | Removed in 1.x (PKCE is S256 only). Setting it to `true` throws at construction. |
| `allowTokenExchangeGrant` | `boolean` | optional | Default false |
| `disallowPublicClientRegistration` | `boolean` | optional | Default false |
| `resourceMetadata` | `{ resource, authorization_servers?, bearer_methods_supported?, resource_name? }` | **`resource` required** | The canonical resource every token is bound to (see §4). |
| `tokenExchangeCallback` | `fn` | optional | Mutate props on `authorization_code` / `refresh_token` exchange |
| `clientRegistrationCallback` | `fn` | optional | Intercept and approve/reject DCR requests |
| `resolveExternalToken` | `fn` | optional | Bridge external OAuth tokens (non-KV) |
| `onError` | `fn` | optional | Error hook; return `Response` to override |
| `clientIdMetadataDocumentEnabled` | `boolean` | optional | Default false; requires `global_fetch_strictly_public` compat flag |
| `enterpriseManagedAuthorization` | `EmaOptions` | optional | Experimental EMA/ID-JAG grant |

### PKCE is S256 only, and the redirect policy is ours

In 0.x `plain` PKCE was an option whose default was the weak setting and had to be
switched off. In 1.x `plain` and the implicit grant were removed from the library:
the discovery document advertises `["S256"]`, a `plain` challenge is refused, and
constructing a provider with either removed option throws.
`tests/unit/mcp/oauth-pkce.spec.ts` keeps our construction site free of both
options; `tests/workers/mcp/native-authorize.spec.ts` ("provider 1.x behaviours")
checks the behaviour against the real provider.

`allowPrivateUseRedirectUris: true` lets the provider accept private-use-scheme
redirect URIs for **every** client, and `/oauth/register` is open. The check that
scopes that is `isRedirectAllowedForScope` in `server/lib/auth/native-consent.ts`,
called by the authorize loader and by its action (which re-reads a request the
browser sent back, so it never went through `parseAuthRequest`). Policy: https and
loopback `http` for anyone; a private-use scheme for native clients, and for other
clients only `cursor`, `vscode`, `vscode-insiders` and `windsurf`; nothing else.

Unrelated, and worth not confusing with the above: the **outbound** Google
Calendar client in `server/lib/calendar/google.ts` also does PKCE, as a client
rather than as a server, and has always sent `S256`.

### `env.OAUTH_PROVIDER` — the `OAuthHelpers` interface

Available inside `defaultHandler.fetch(request, env, ctx)` and `apiHandler.fetch(request)` via `this.env`:

```ts
// Parse the incoming OAuth authorization request
const oauthReqInfo: AuthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);

// Look up a registered client
const client: ClientInfo | null = await env.OAUTH_PROVIDER.lookupClient(clientId: string);

// Complete an authorization (returns redirect URL)
const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,     // AuthRequest from parseAuthRequest()
  userId: string,            // opaque user identifier
  metadata: unknown,         // audit metadata (not encrypted, visible in listUserGrants)
  scope: string[],           // granted scopes
  props: unknown,            // arbitrary payload — encrypted into token, passed to apiHandler as ctx.props
  revokeExistingGrants?: boolean,         // default true
});

// Enumerate grants for a user (for audit/revocation UI)
const grants: ListResult<GrantSummary> = await env.OAUTH_PROVIDER.listUserGrants(
  userId: string,
  options?: { limit?: number; cursor?: string }
);

// Revoke a single grant
await env.OAUTH_PROVIDER.revokeGrant(grantId: string, userId: string);

// Inspect / decode an existing token
const summary: TokenSummary<T> | null = await env.OAUTH_PROVIDER.unwrapToken<T>(token: string);

// Client management
await env.OAUTH_PROVIDER.createClient(partial: Partial<ClientInfo>): Promise<ClientInfo>;
await env.OAUTH_PROVIDER.listClients(opts?: ListOptions): Promise<ListResult<ClientInfo>>;
await env.OAUTH_PROVIDER.updateClient(clientId, updates): Promise<ClientInfo | null>;
await env.OAUTH_PROVIDER.deleteClient(clientId): Promise<void>;

// Garbage collection (call from a Cron Trigger)
await env.OAUTH_PROVIDER.purgeExpiredData(opts?: PurgeOptions): Promise<PurgeResult>;
```

The `props` passed to `completeAuthorization()` are **end-to-end encrypted** at rest in KV using
the access token as key material. On every authenticated API request the provider decrypts them
and injects them into the execution context as `ctx.props`. Inside a `WorkerEntrypoint`
apiHandler, `this.ctx.props` holds the decrypted props object.

---

## 3. The MCP handler — import path, options, how props arrive

```ts
import { createMcpHandler } from 'agents/mcp/server';
```

`createMcpHandler(factory, options)` returns a handler `(request, env, ctx) => Promise<Response>`.
The factory is called on **every** request and must return a new `McpServer`.
Options we use (`server/lib/mcp/handler.ts`):

- `route: '/mcp'` — an exact pathname match, so `/mcp/{slug}` is reduced to `/mcp` first
  (`stripMcpSlugPrefix`), and `/mcp/` or `/mcp/acme/extra` do not match.
- `legacy: 'stateless'` — a client that opens with `initialize` (2025-11-25 and earlier) is
  served per request with no session; `GET` and `DELETE` answer `405`.
- `allowedOriginHostnames` — an array **replaces** the library's default list (localhost and
  `workers.dev`), it does not extend it, so the localhost set is spelled out
  (`localhostAllowedOrigins()`) and the engine's own hostname is added. Matching is by
  hostname only. A request with no `Origin` header is always accepted.
- `authContext: { props }` — the verified grant props, readable from handlers.

The handler module is only reached through a dynamic `import()` in `oauth-provider.ts`, so a
deployment with MCP switched off never evaluates it. Never `export default createMcpHandler(...)`:
Wrangler treats a function default export as an entrypoint class.

### How the props arrive

1. **Authorization flow**: the consent action calls `completeAuthorization({ ..., props })`. The
   provider encrypts `props` into the grant.
2. **Authenticated request**: the provider decrypts the token and sets `ctx.props` before calling
   the `apiHandler` (`buildOAuthHandler` in `server/lib/mcp/oauth-provider.ts`).
3. **Guards, in order**: a grant that claims to be native is `403`; MCP switched off is `404`; a
   slug in the path that differs from `props.tenantSlug` is `403 tenant_mismatch`; missing props
   is `401`.
4. **Server construction**: `buildMcpServer(env, props)` (`server/lib/mcp/build-server.ts`)
   registers the tools, resources and prompts the grant's scopes allow. The identity-free part
   (scope selection, schemas) is cached per scope set, bounded to 64 entries.

The `McpServer`, `ResourceTemplate` and protocol error types come from one seam,
`server/lib/mcp/sdk.ts`; nothing else imports the server package directly.

---

## 4. SaaS apiRoute strategy — spec §11.1 and §11.3

### §11.1 — Does the provider emit PATH-SCOPED RFC 9728 PRM?

**Yes, with dynamic derivation.** The provider serves RFC 9728 Protected Resource Metadata not only
at `/.well-known/oauth-protected-resource` (host-root) but also at any path-suffixed variant per
RFC 9728 §3.1:

```
/.well-known/oauth-protected-resource         → resource: https://host.com
/.well-known/oauth-protected-resource/mcp     → resource: https://host.com/mcp
/.well-known/oauth-protected-resource/mcp/acme → resource: https://host.com/mcp/acme
```

Source: `deriveResourceIdentifier(requestUrl)` in `oauth-provider.js` (line ~978):
```js
// pathname.slice(37) strips the 37-char "/.well-known/oauth-protected-resource" prefix
const suffix = requestUrl.pathname.slice(37);
if (!suffix || suffix === '/') return requestUrl.origin;
return `${requestUrl.origin}${suffix}`;
```

This derivation is used only when `resourceMetadata.resource` is **not** statically configured.
If `resourceMetadata.resource` is set, it overrides dynamic derivation for all PRM requests.

The `authorization_servers`, `scopes_supported`, and `bearer_methods_supported` fields in the
PRM response are the same for all path variants — only the `resource` identifier differs.

### §11.3 — SaaS apiRoute strategy

**Conclusion: both modes use `apiRoute: '/mcp'`. Standalone serves the single fixed
endpoint `/mcp`; SaaS serves per-workspace endpoint URLs `/mcp/{slug}` under the same
prefix. Every token is bound to ONE canonical resource, `<origin>/mcp`. The tenant slug is
present in the URL path (to select the workspace endpoint) and in the OAuth grant `props`
(the authoritative value for tenant scoping); the two must agree.**

> **Superseded — the SaaS mount used to be `apiRoute: '/company/'`.** `apiRoute` is a
> literal prefix, so that value made the OAuth provider treat EVERY `/company/*` request
> as an authenticated API request. Narrowing the mount to `/mcp` released `/company/*`.

> **Superseded — per-workspace resource identifiers.** With provider 0.x each workspace
> endpoint had its own resource identifier (`https://host.com/mcp/acme`) and tokens were
> bound to it. Provider 1.x requires one configured resource. Isolation between workspaces
> therefore does not come from the token audience: the handler rejects any request whose
> path slug differs from the granted `props.tenantSlug`, and data access is scoped by the
> grant's tenant. Grants made against a workspace resource cannot refresh after the upgrade
> (`400`, `invalid_grant` or `invalid_target`); the user connects again.

How `apiRoute` matching works (mechanical facts that shape the implementation):

- `apiRoute` is a **literal string prefix match** — no patterns, no wildcards. The prefix
  `'/mcp'` covers `/mcp` and `/mcp/{slug}` alike; the handler matches the precise shape. In 1.x
  every route must also be the resource's path or a descendant of it.
- The URL slug and `props.tenantSlug` MUST agree — the handler rejects any request where they
  differ (prevents a token for one workspace being used against another workspace's URL).

**Discovery.** The protected-resource metadata is served at
`/.well-known/oauth-protected-resource/mcp` with `resource: <origin>/mcp`. The `401` challenge
for both `/mcp` and `/mcp/{slug}` carries `resource_metadata` pointing at that one document. The
per-workspace metadata path of 0.x (`.../mcp/{slug}`) answers `404`. Pinned by
`tests/workers/mcp/native-authorize.spec.ts`.

**Standalone:** endpoint `/mcp`, no slug segment, so the slug guard is inert by construction.

**SaaS:** endpoint `/mcp/{slug}`; the slug is validated against `props.tenantSlug`, then the
path is reduced to `/mcp` before the handler's exact route match.

> **Why one handler covers both modes.** The slug guard fires on the PATH shape, not on the
> mode: `/mcp` has no slug segment and is delegated untouched, `/mcp/{slug}` is checked and
> reduced. Deriving the guard from the request rather than from a second mode flag is what
> stops the two from drifting apart (OI #308).

---

## 5. Required wrangler.jsonc additions

MCP needs the `OAUTH_KV` namespace and the `nodejs_compat` flag (`agents/mcp/server` uses
`node:async_hooks`). **No Durable Object is needed any more.** The committed `wrangler.jsonc`
still declares the retired `InspectorMcp` class and its `v3` migration, kept only so the class
already deployed keeps resolving until a dedicated deletion migration ships (see
[`mcp-migration-decisions.md`](mcp-migration-decisions.md)):

```jsonc
{
  "durable_objects": { "bindings": [ { "name": "INSPECTOR_MCP", "class_name": "InspectorMcp" } ] },
  "kv_namespaces": [ { "binding": "OAUTH_KV", "id": "<your-kv-id>" } ],
  "migrations": [ { "tag": "v3", "new_sqlite_classes": ["InspectorMcp"] } ]
}
```

The `OAUTH_KV` binding name is hardcoded in `@cloudflare/workers-oauth-provider` — it cannot be
changed without forking the library.
