# Deployment modes — standalone vs saas

OpenInspection runs in one of two modes. **Standalone is the default and is what
a self-hosted install uses**: one fixed tenant holds all your data, and you are
the platform. `saas` is what a multi-tenant deployment sets, and it exists in
this repository because the same code serves both.

The mode is selected by one environment variable:

```
APP_MODE=saas     # anything else, including unset, means standalone
```

Everything that depends on the mode is decided in **one file** —
`server/lib/deployment-profile.ts` — which exports two immutable profiles and a
pure function that resolves one from the environment. Nothing else in the worker
reads `APP_MODE`; a gate in `tests/unit/sync/portal-isolation.spec.ts` keeps it
that way.

> The table below is **generated** from those two constants by
> `npm run docs:modes`. Do not edit it by hand — edit the constants, then
> regenerate. `tests/unit/platform/deployment-modes-doc.spec.ts` fails if the
> two disagree.

<!-- BEGIN GENERATED: capability table -->

| Capability | standalone | saas | What it decides |
|---|---|---|---|
| `mode` | `standalone` | `saas` | Which profile is active. `APP_MODE=saas` selects saas; anything else is standalone. |
| `fixedTenantId` | `SINGLE_TENANT_ID`, or an all-zero UUID when unset | none — resolved per request | The single tenant every request resolves to. Standalone has exactly one; saas resolves a tenant per request. |
| `hasBilling` | no | yes | Subscription billing surfaces exist (Settings → Billing). |
| `hasSeatQuota` | no | yes | The number of team members is capped by a plan. |
| `hasUsageQuota` | no | yes | Metered usage is capped by a plan. |
| `billingPortalUrl` | none | derived from `PORTAL_API_URL` | Where the browser is sent to manage a subscription. |
| `loginRedirectBase` | none — local login form | derived from `PORTAL_API_URL` | Where the browser is sent to sign in. Standalone serves its own login form; saas bounces to the portal and `POST /api/auth/login` returns 410. |
| `hasSetupWizard` | yes | no | `/setup` exists, gated on the `SETUP_CODE` secret, to create the first account. |
| `aiDevMockFallback` | yes | no | AI calls may fall back to a local mock when no credential resolves. |
| `hasManagedAi` | no | yes | A platform-provided AI credential can ever be resolved. Standalone has no platform, so the managed path is absent rather than disabled — use your own key in Settings → Advanced → AI. |
| `brandingSource` | `env` | `tenant-config` | Where the company name and colour come from: `env` (`APP_NAME` / `PRIMARY_COLOR`) or per-tenant config edited in Settings. |
| `mcpApiRoute` | `/mcp` | `/company/` | Where the MCP OAuth surface mounts. |
| `videoBackendManaged` | no | yes | Whether the platform picks the video backend. Standalone operators set `videoMode` themselves, which is why the self-host settings form exists and the saas one refuses to save. |
| `hasManagedCompliance` | no | yes | A platform-operated compliance path (managed SMS 10DLC brand/campaign filing) exists. Absent in standalone — nobody can file on your behalf. |
| `hasContentMarketplace` | no | yes | The content marketplace surface exists. Standalone 404s the browse route rather than rendering an empty shelf: the catalogue is curated first-party and nothing can reach it. |
| `qboAppManaged` | no | yes | The platform supplies the Intuit app tenants connect through, so nobody is asked for a Client ID. Standalone brings its own: Intuit matches a redirect URI byte for byte and a self-hosted deploy answers on its own domain, so the platform app cannot work there — which is why the credential form, including `QBO_ENV`, renders only in standalone. |
| `tenantRecordOwnedByPortal` | no | yes | Whether a platform stores the authoritative tenant record and this worker reads a projection of it. Decides which admin provider is constructed; in standalone this deployment owns the row outright. |
| `hasPortalIntegrationApi` | no | yes | Whether the portal machine-to-machine surface (`/api/integration/*`) is mounted. Standalone 404s the whole prefix rather than answering on an API nobody can authenticate to. |
| `botProtectionMandatory` | no | yes | Whether the public booking form and agent signup MUST carry a bot challenge. Saas always challenges — with no `TURNSTILE_SECRET_KEY` it uses Cloudflare's published test key rather than skipping, so the mechanism is permissive but never off. Standalone leaves it to the operator: no key, no challenge. |

<!-- END GENERATED: capability table -->

## The two real forks in the flow

Most of the table is "this capability is absent in standalone", not "this works
differently". Only two things genuinely branch, and both are at the front door.

### First account

**Standalone** — `/setup` exists. It is gated on the `SETUP_CODE` secret alone:
if the secret is unset the endpoint refuses to proceed, so an unprovisioned
Worker cannot be claimed by whoever finds the URL. Once one account exists,
`/setup` returns `already_initialized` and everyone else joins by invitation.

**saas** — there is no `/setup`. Workspaces are created by the portal.

### Signing in

**Standalone** — `/login` serves a local form and `POST /api/auth/login`
authenticates against it. One tenant means an email identifies a person
unambiguously.

**saas** — `GET /login` and `GET /forgot-password` 302 to the portal, and
`POST /api/auth/login` returns HTTP 410 `LOGIN_MOVED_TO_PORTAL`. The reason is
data-shaped, not a policy: a saas deployment shares one D1 across many tenants
and `users.email` is unique per `(tenant_id, email)`, so a local form has no way
to tell which tenant an address belongs to. Entry is exclusively through the
portal handoff.

## Reading a capability in code

Never write `env.APP_MODE === 'saas'`. Read the capability, by what you are
holding:

| You have | Read |
|---|---|
| A Hono handler or middleware | `c.var.profile.<capability>` |
| Only an env (RR loader/action, cron, Workflow, queue consumer) | `getDeploymentProfile(env).<capability>` |
| A client component | `isSaas` / `deployment.mode` from the session context |

`getDeploymentProfile` takes `ProfileEnv` — the three fields it actually reads —
rather than the full `AppEnv`, so every env shape in the worker satisfies it
structurally with no cast. Demanding the full `AppEnv` is what previously pushed
nine call sites into writing their own branch.

Adding a capability means adding a field to `DeploymentProfile`, a value to both
constants, and a line to `DESCRIPTIONS` in
`scripts/gen-deployment-modes-doc.ts`. The doc spec fails until you do all
three.

## Per-tenant deployment mode is a different thing

`tenants.deploymentMode` (`shared` | `silo`) is a per-tenant property that
signals which D1 backend to query. It is not this deployment-wide topology, and
it does not exist in a standalone install. Silo and shared saas collapsed into
one `SAAS_PROFILE` in 2026-05.
