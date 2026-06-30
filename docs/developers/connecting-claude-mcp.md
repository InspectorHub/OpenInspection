# Connecting Claude (MCP) to OpenInspection

OpenInspection ships a built-in **remote MCP server** so you can drive your
inspection data from Claude (or any MCP client) over the network — no plugin to
install, no API key to copy around. Access is brokered by **OAuth 2.1**: the
client gets a scoped, revocable token after you approve it on a consent screen.

The MCP server is **off by default**. An operator must enable it, after which
each user authorizes the clients they want and manages those grants from
Settings.

---

## 1. Enable the server (operator)

Set the `MCP_ENABLED` environment variable to `true` (or `1`) on the worker and
redeploy. When it is unset/anything else, the entire OAuth + MCP surface is not
mounted — existing behavior is byte-for-byte unchanged and `/mcp` returns 404.

```jsonc
// wrangler.jsonc / wrangler.saas.jsonc  → "vars"
{
  "vars": {
    "MCP_ENABLED": "true"
  }
}
```

```bash
npm run deploy          # standalone
npm run deploy:saas     # SaaS
```

No other configuration is required: OAuth client registration is dynamic
(RFC 7591), and the server reuses the deployment's existing JWT keyring to mint
the short-lived internal token that carries your identity into the API.

---

## 2. The MCP endpoint URL

The URL depends on the deployment mode:

| Mode | MCP endpoint |
|---|---|
| **Standalone** (single-tenant / self-host) | `https://<your-host>/mcp` |
| **SaaS** (multi-tenant) | `https://<your-host>/company/<company-slug>/mcp` |

In SaaS, the company slug in the path scopes the connection to one company. A
user who belongs to several companies makes **one connection per company** (see
§6) — there is no in-session "switch"; each connection carries its own token and
company.

OAuth discovery and endpoints (you normally never type these — the client finds
them automatically):

- Protected-resource metadata (RFC 9728): `/.well-known/oauth-protected-resource`
  (and the path-scoped variant for the endpoint, e.g.
  `/.well-known/oauth-protected-resource/mcp`)
- Authorization: `/oauth/authorize`
- Token: `/oauth/token`
- Dynamic client registration (RFC 7591): `/oauth/register`

---

## 3. Add the connection in Claude

Using the Claude Code CLI:

```bash
claude mcp add --transport http openinspection https://<your-host>/mcp
# SaaS:
claude mcp add --transport http openinspection https://<your-host>/company/<company-slug>/mcp
```

The first time Claude calls a tool, it discovers the OAuth metadata, registers
itself, and opens your browser to the consent screen. Other MCP clients work the
same way — point them at the endpoint URL above; they handle the OAuth handshake
(authorization code + PKCE) on their own.

---

## 4. Approve access (the consent screen)

The browser lands on the OpenInspection consent page:

1. **Sign in** if you aren't already.
   - Standalone: the local login form.
   - SaaS: you're bounced to the portal single-sign-on and returned here.
2. **Choose what the client may access.** Access is granted per **module**
   (Inspections, Bookings, Templates, Contacts, Invoices, Reports & Repair,
   Messaging, and — for owners/managers — Admin & Settings) with a **Read** and a
   **Write** checkbox each. This is deliberately coarse, like a fine-grained
   personal access token: you pick modules and read/write, not individual
   endpoints.
3. **Approve.** The client receives a token whose scope is the **intersection**
   of what it requested, what you ticked, and what your role is allowed to grant
   (e.g. an inspector cannot grant admin scopes; agents are read-mostly). Write
   access implies read for the same module.

That's it — Claude can now call the tools your grant covers.

---

## 5. Review and revoke (Settings → Connected applications)

Go to **Settings → Connected applications**:

- **Your applications** — every client you've authorized, the modules and
  read/write it holds, and when the grant was created/expires. **Revoke** any
  grant; the token stops working immediately.
- **Tenant-wide** (owners and managers only) — the same view across everyone in
  the company, grouped by user, so an admin can audit and revoke on behalf of
  the team.

**Changing permissions = revoke + re-authorize.** OAuth scopes are fixed at
consent time; there is no in-place edit. To widen or narrow what a client can
do, revoke the grant and connect again, ticking the new set of modules. Revokes
are recorded in the audit log.

---

## 6. Multiple companies (SaaS)

Because each connection's token is scoped to a single company, working across
companies means adding one MCP connection per company, each with that company's
slug in the URL:

```bash
claude mcp add --transport http acme  https://<your-host>/company/acme/mcp
claude mcp add --transport http globex https://<your-host>/company/globex/mcp
```

Each connection has its own consent and its own revocable grant.

---

## 7. What tools are exposed

Tools are generated from the API's OpenAPI metadata: every route marked as a
`primary`-tier MCP route becomes a tool named `openinspection_<operation>`, and a
tool is only offered to a connection when the connection's granted scope covers
that route's required scope and module tag. Routes tagged `excluded` are never
exposed. Routes tagged `extended` are off by default; an operator can expose
them by setting `MCP_EXTENDED_TOOLS=true` in the deployment env (they stay
scope-gated). See [Route Metadata Conventions](07_route_metadata.md) for how
routes opt in, and [mcp-oauth-notes.md](mcp-oauth-notes.md) for the server's
internal architecture.

---

## 8. Resources and prompts

Beyond tools, the connection also exposes:

- **Resources** — read-only views of your data the client can pull into context
  without invoking a tool. Every granted read (`GET`) route is available as a
  resource: collections at `openinspection:///api/<thing>` and single records at
  `openinspection:///api/<thing>/{id}`. They honor the same scope grant as
  tools, and reads run as you through the same tenant-scoped API.
- **Prompts** — ready-made templates the client can offer you, such as
  *Summarize inspection*, *Draft repair request*, *Review findings*, and
  *Client follow-up email*. Each prompt only appears when your grant covers the
  data it needs (e.g. the follow-up-email prompt requires the Contacts module).
  Prompts carry no data themselves — they hand the model a starting instruction
  that uses the tools and resources above.
