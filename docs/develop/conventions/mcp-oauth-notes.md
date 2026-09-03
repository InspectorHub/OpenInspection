<!-- no-portal-routes-allow-file: every remaining `/company/` here is a NEGATIVE statement — the SaaS MCP mount used to be `apiRoute: '/company/'` and no longer is. They are kept because the reason that prefix was wrong is the reason nobody should reach for it again; none of them is a link to a hosted screen, and this engine now claims nothing under `/company/*`. -->

# MCP Remote + OAuth Integration — Discovery Notes

> Produced by Task A0 spike (2026-06-29). Later tasks depend on the exact symbol names
> recorded here — update this file if a package version bump changes the API surface.

---

## 1. Resolved package versions

| Package | Resolved version | Notes |
|---|---|---|
| `@cloudflare/workers-oauth-provider` | **0.8.1** | latest stable |
| `agents` | **0.17.1** | latest stable |
| `@modelcontextprotocol/sdk` | **1.29.0** | pinned by `agents` too |
| `zod` (project) | **4.4.3** | our existing floor |

### Zod compatibility verdict

**No conflict.** `@modelcontextprotocol/sdk@1.29.0` declares `peerDependencies: { zod: "^3.25 || ^4.0" }`.
`agents@0.17.1` declares `peerDependencies: { zod: "^4.0.0" }`. Both work with our existing
`zod@^4.4.3`. `npm ls` confirms a single `zod@4.4.3` at the root, with only
`@cloudflare/vitest-pool-workers` nesting an unrelated `zod@3.25.76` under itself.
No `overrides` entry is needed for zod.

### React 19 peer dep conflict (agents)

`agents@0.17.1` requires `react@^19.0.0` as a **peer dependency** (not listed in `peerDependenciesMeta`
as optional). Our project is on `react@^18.3.1` and is not ready to upgrade to React 19 —
that would be a large, unrelated breaking change.

**Resolution:** Install with `--legacy-peer-deps`. The React 19 peer dep exists because
`agents` ships frontend hooks (imported via `agents/react`) that target React 19's concurrent
features. We only import from `agents/mcp` (the Durable Object base class) which has zero
React runtime dependency. The peer dep requirement is a metadata-level constraint with no
runtime impact for our server-side usage.

A project-root `.npmrc` with `legacy-peer-deps=true` is committed alongside `package.json`
so `npm install` works for all developers and CI without passing the flag explicitly.

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
| `refreshTokenTTL` | `number` | optional | Seconds; default 2,592,000 (30 days); `0` disables |
| `clientRegistrationTTL` | `number` | optional | Seconds; default 7,776,000 (90 days) |
| `allowImplicitFlow` | `boolean` | optional | Default false |
| `allowPlainPKCE` | `boolean` | optional | Default true |
| `allowTokenExchangeGrant` | `boolean` | optional | Default false |
| `disallowPublicClientRegistration` | `boolean` | optional | Default false |
| `resourceMetadata` | `{ resource?, authorization_servers?, scopes_supported?, bearer_methods_supported?, resource_name? }` | optional | Customises `/.well-known/oauth-protected-resource` |
| `resourceMatchOriginOnly` | `boolean` | optional | Default false; when true, compares origins only during resource validation |
| `tokenExchangeCallback` | `fn` | optional | Mutate props on `authorization_code` / `refresh_token` exchange |
| `clientRegistrationCallback` | `fn` | optional | Intercept and approve/reject DCR requests |
| `resolveExternalToken` | `fn` | optional | Bridge external OAuth tokens (non-KV) |
| `onError` | `fn` | optional | Error hook; return `Response` to override |
| `clientIdMetadataDocumentEnabled` | `boolean` | optional | Default false; requires `global_fetch_strictly_public` compat flag |
| `enterpriseManagedAuthorization` | `EmaOptions` | optional | Experimental EMA/ID-JAG grant |

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
  revokeExistingGrantsBatchSize?: number, // default 50
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

## 3. McpAgent — import path, serve signature, Props generic, this.props

### Import path

```ts
import { McpAgent, getMcpAuthContext } from 'agents/mcp';
```

The `agents/mcp` export (defined in `agents` package.json `exports[./mcp]`) maps to
`dist/mcp/index.js`. `McpAgent` is the only abstract base class needed for a DO-hosted MCP server.

### Class declaration

```ts
abstract class McpAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>
> extends Agent<Env, State, Props>
```

Generic position: **Env, State, Props** (in that order). For a tenant-aware agent:

```ts
type MyProps = { tenantSlug: string; userId: string; scopes: string[] };
class InspectionMcpAgent extends McpAgent<Env, never, MyProps> { ... }
```

### `serve()` signature

```ts
static serve(
  path: string,
  {
    binding = 'MCP_OBJECT',   // wrangler.jsonc DO binding name; change if needed
    corsOptions?: CORSOptions,
    transport?: 'streamable-http' | 'sse' | 'auto',  // default 'streamable-http'
    jurisdiction?: DurableObjectJurisdiction
  }?: ServeOptions
): { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
```

`McpAgent.serve()` returns a fetch handler object that routes incoming HTTP/WebSocket requests
to the Durable Object. The DO instance name is `streamable-http:{sessionId}` (where `sessionId`
comes from the `mcp-session-id` request header, or a new unique ID for a fresh session).

### How `this.props` is populated

1. **Authorization flow**: The consent handler calls `env.OAUTH_PROVIDER.completeAuthorization({ ..., props: { tenantSlug, userId, ... } })`. The provider encrypts `props` into the access token.
2. **Authenticated API request**: `OAuthProvider` decrypts the token and sets `ctx.props` on the execution context before forwarding the request to the `apiHandler`.
3. **Inside `McpAgent.serve()`**: The handler calls `getAgentByName(namespace, doName, { props: ctx.props })`. The framework calls `onStart(props?: Props)` on the DO, which sets `this.props`.
4. **Inside the DO**: `this.props` (typed as `Props | undefined`) holds the decrypted OAuth grant props. Access them in `init()`, tool handlers, etc.

The `updateProps(props?: Props)` method re-runs `onStart` and persists new props to DO storage.

For non-DO MCP servers (using `createMcpHandler`), use `getMcpAuthContext()` which returns
`McpAuthContext | undefined` — reads `{ props: Record<string, unknown> }` from AsyncLocalStorage.

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
prefix. The tenant slug is present in BOTH the URL path (for per-workspace URLs +
per-workspace RFC 8707 resource binding) AND the OAuth grant `props` (the authoritative
value the DO trusts for tenant scoping).**

> **Superseded — the SaaS mount used to be `apiRoute: '/company/'`.** `apiRoute` is a
> literal prefix, so that value made the OAuth provider treat EVERY `/company/*` request
> as an authenticated API request. It held a whole top-level namespace hostage to a "do
> not add a `/company/*` route" caveat written in this file — a rule enforced by nothing,
> in a document a route author has no reason to open. Narrowing the mount to `/mcp`
> releases `/company/*` and deletes the caveat instead of restating it. An even earlier
> draft used the abbreviated `/t/` prefix — also superseded.

The design deliberately keeps **tenant-in-URL + RFC 8707 resource indicator**; only the
prefix changed. The path-based approach is REQUIRED — not merely cosmetic — because two
things a query-string approach cannot provide are mandatory here:

1. **Per-workspace distinct URLs** — each workspace gets its own canonical MCP endpoint
   (`https://host.com/mcp/acme`), so MCP clients register and store one URL per workspace.
2. **Per-workspace RFC 8707 resource binding** — path-scoped RFC 9728 PRM derives a *distinct*
   resource identifier per workspace (`/.well-known/oauth-protected-resource/mcp/acme` →
   `resource: 'https://host.com/mcp/acme'`). Access tokens are then bound (via the RFC 8707
   `resource` indicator) to that specific workspace's resource, so a token minted for `acme`
   cannot be replayed against `globex`'s endpoint.

How `apiRoute` matching works (mechanical facts that shape the implementation):

- `apiRoute` is a **literal string prefix match** — no patterns, no wildcards, no `:slug`
  expansion. A slug-parameterized value would only match URLs literally containing the
  characters of the parameter (the colon is literal), so it CANNOT be used. The prefix
  `'/mcp'` covers `/mcp` and `/mcp/{slug}` alike, and the handler matches the precise
  shape.
- The tenant slug is parsed from the URL path segment to select the workspace endpoint, but the
  DO trusts `this.props.tenantSlug` (encrypted in the OAuth grant) as the authoritative tenant
  for all data access. The URL slug and the props slug MUST agree — the handler rejects any
  request where the path slug ≠ the granted `props.tenantSlug` (prevents a token for one
  workspace being used against another workspace's URL).
- The DO instance name is determined by session ID (`streamable-http:{sessionId}`), not by slug.

**Standalone:** endpoint `/mcp`
- Single fixed endpoint; no slug segment, so the slug guard is inert by construction
- PRM auto-served at `/.well-known/oauth-protected-resource/mcp` → `resource: 'https://host.com/mcp'`
- `this.props.tenantSlug` carries the tenant from the OAuth grant (SINGLE_TENANT_ID is the only tenant)

**SaaS:** endpoint `/mcp/{slug}`
- Same registered prefix `'/mcp'`; the slug is the segment after it
- Per-workspace PRM is auto-derived: `/.well-known/oauth-protected-resource/mcp/acme` →
  `resource: 'https://host.com/mcp/acme'` (distinct resource id per workspace = RFC 8707 binding)
- The MCP agent (DO) reads `this.props.tenantSlug` for tenant scoping; path slug is validated against it
- `McpAgent.serve('/mcp')` matches its mount literally via URLPattern, so the handler reduces
  `/mcp/{slug}` back to `/mcp` before delegating

> **Why one handler covers both modes.** The slug guard fires on the PATH shape, not on the
> mode: `/mcp` has no slug segment and is delegated untouched, `/mcp/{slug}` is checked and
> reduced. Deriving the guard from the request rather than from a second mode flag is what
> stops the two from drifting apart (OI #308).

**Rejected alternative — `apiRoute: '/mcp'` + `?workspace={slug}` query param.** Simpler to
route, but it FAILS the spec's requirements: all workspaces would share the single endpoint URL
`https://host.com/mcp` and therefore a single PRM resource identifier (`https://host.com/mcp`).
That collapses the per-workspace RFC 8707 resource binding — one token would be valid for the
shared resource regardless of workspace, losing the per-workspace token isolation §4.2 requires.

---

## 5. Required wrangler.jsonc additions

For any MCP integration to work, the following must be present in wrangler.jsonc:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "InspectionMcpAgent" }
    ]
  },
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "<your-kv-id>" }
  ],
  "migrations": [
    { "tag": "v2", "new_sqlite_classes": ["InspectionMcpAgent"] }
  ]
}
```

The `OAUTH_KV` binding name is hardcoded in `@cloudflare/workers-oauth-provider` — it cannot be
changed without forking the library.

The `MCP_OBJECT` binding name can be changed: pass `{ binding: 'YOUR_BINDING' }` to `McpAgent.serve()`.
