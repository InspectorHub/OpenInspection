# MCP endpoint: stateless handler and OAuth provider 1.x

Engineering record of the change that moved the remote MCP endpoint from a
session-hosting Durable Object to a stateless request handler, and the OAuth
provider library from 0.8 to 1.x. It records mechanisms and decisions. For how
the pieces work today, read [`mcp-oauth-notes.md`](mcp-oauth-notes.md).

## Two protocol eras, one endpoint

The MCP wire protocol has two generations in use at once:

- **2025-11-25 and earlier.** The client opens with `initialize`, then sends
  further requests. Servers traditionally kept a session for it.
- **2026-07-28.** Every request carries its own protocol version and
  capabilities. No handshake, no session.

Some widely used clients (editors in particular) still speak only the older
generation, so the endpoint serves both from the same URL. The handler is
created per request from `agents/mcp/server` (`createMcpHandler`) with
`legacy: 'stateless'`:

- a request that carries its own version is served directly;
- a request that opens with `initialize` is served by a per-request lane that
  keeps **no session**, so `GET` and `DELETE` on `/mcp` answer `405`;
- the factory builds a **new** `McpServer` for every request from the verified
  grant (`ctx.props`). A server is never shared between requests, because a
  shared instance would answer one caller from another caller's registrations.

The identity-free part of registration (which tools a scope set allows, and
their schemas) is cached per scope set in a bounded map; handlers are created
per request and close over the caller's props.

The Durable Object class `InspectorMcp` is retained as an empty shell (it answers
`410` and has a no-op `alarm()`), and its binding and migration are untouched. A
class can only be removed by a dedicated deletion migration, which is a one-way
step, so it ships as its own later release after this one has been observed.

## Resource strategy

Provider 1.x binds every token to one canonical resource. The decision:

- The resource is `<origin>/mcp`, derived from `APP_BASE_URL` (or the request
  origin when it is unset). `/mcp/{slug}` is a path under it.
- Discovery for `/mcp/{slug}` answers its `401` with a challenge pointing at the
  metadata document for `/mcp`, so a client that follows the challenge learns
  the canonical resource whichever URL it was configured with. The
  per-workspace metadata path of the earlier provider no longer exists.
- Tenant isolation does not rest on the token audience. The workspace slug in
  the URL must equal the workspace in the verified grant (`tenant_mismatch`,
  403), and all data access is scoped by the grant's tenant.
- A deployment with no usable origin (not https, not loopback) leaves the OAuth
  and MCP paths answering `503`; every other path is served unchanged.

Consequence, accepted: grants created against the old per-workspace resource are
bound to that path and cannot refresh. The refresh fails with `400` and
`invalid_grant` or `invalid_target`, never a server error, and the user connects
again. Authorization requests that name a workspace path as the `resource` get a
standard OAuth `invalid_target` error. Resource validation is not relaxed to
avoid this.

## Redirect URIs

`allowPrivateUseRedirectUris` is a provider-wide switch. The per-scope policy is
ours (`isRedirectAllowedForScope`), applied by both the authorize loader and its
action:

- https, and loopback `http` (`127.0.0.1`, `[::1]`, `localhost`): any client;
- private-use schemes: native clients (scope `native`, valid native redirect);
  for other clients only the editor schemes `cursor`, `vscode`,
  `vscode-insiders`, `windsurf`;
- everything else, including `javascript:`, `data:` and remote `http`: refused.

## Refresh token lifetime

In 1.x a per-grant "never expires" can no longer be expressed. Native grants get
a finite lifetime at code exchange (400 days) and a 90-day idle window re-armed
on every refresh; MCP grants keep the library default (30 days). Because the
provider enforces the idle window by expiring the grant, an unused native grant
is refused by the provider and then dropped by the store's own expiry, rather
than being revoked at the moment of the refused refresh.

## Browser origins

Requests that carry an `Origin` header are accepted from loopback hosts and the
engine's own host only; other origins get `403`. Requests with no `Origin`
(non-browser clients) are always accepted.
