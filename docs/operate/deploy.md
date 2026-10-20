# Deploying OpenInspection

This guide covers self-hosted production deploys — what every adopter does to run the engine for their own inspection business.

---

## Architecture overview

OpenInspection deploys as a single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape):

- **`workers/app.ts`** — a Hono entry that mounts the full API (`server/`, Hono + Drizzle + D1) in-process for API-owned paths and delegates all other (page) routes to React Router v8 SSR (`app/`, React 19 + Tailwind v4).
- React Router loaders/actions call the API DIRECTLY through an injected in-process `API_WORKER` self-binding — no network hop, no second worker, no Service Binding between workers.

One deployable; `npm run deploy` builds and ships it.

---

## Self-hosted production deploy

The recommended path is the one-click button in the README:

```
[Deploy to Cloudflare] → fork → run `npm run setup:cloudflare`
```

For the manual flow, see the **Quick start** section in the [README](../../README.md).

> **Already deployed?** To move an existing deployment to a newer release, see [`upgrade.md`](upgrade.md) — it covers backups, applying new migrations, and verifying the deployed version.

### Required Cloudflare resources

| Resource         | Binding         | Purpose                                                    |
|------------------|-----------------|------------------------------------------------------------|
| Worker           | (one worker)    | Single Worker (API in-process + React Router SSR).        |
| D1 database      | `DB`            | All structured data (inspections, users, comments, ...).   |
| R2 bucket        | `PHOTOS`        | All object storage — field-form photos, pre-rendered report/certificate PDFs, and e-sign evidence packs. |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Images binding   | `IMAGES` (optional) | Downscales Appendix B photos before embedding them in Word (.docx) exports. |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |
| Durable Objects  | `INSPECTION_PRESENCE`, `TENANT_PRESENCE` | Live presence for the editor.               |
| Durable Object   | `INSPECTION_DOC` | The collaborative results document (Yjs CRDT). Absent → the editor's collab routes return `501` and collaborative editing does not engage. |
| Durable Object   | `INSPECTOR_MCP`  | Retired. The remote MCP endpoint is a stateless request handler and nothing routes to this class; the binding stays only until the migration that deletes it ships. Do not remove it from an existing deployment's config on your own: deleting a Durable Object class takes a dedicated migration step. (`NATIVE_CLIENT_ENABLED` enables native app sign-in on the same OAuth provider; see [`../develop/native-clients.md`](../develop/native-clients.md).) |
| KV namespace     | `OAUTH_KV`       | OAuth grants (MCP and native app sign-in). The binding NAME is fixed by `@cloudflare/workers-oauth-provider`. |
| Queue            | `CRON_QUEUE`     | **Background jobs run on this queue, one job per invocation.** With it unbound the tick logs `CRON_QUEUE is not bound — no job will run` and every sweep, reminder and retention job stops. |
| Queue            | `WORD_EXPORT_QUEUE` | Async `.docx` export. |
| Stream binding   | `STREAM` (optional) | Cloudflare Stream video backend. Absent → video stays on R2, which is the default. |

⚠️ **`npm run setup:cloudflare` does not provision all of them.** It creates the
D1 database, **one** KV namespace (`TENANT_CACHE`) and the `PHOTOS` R2 bucket,
and writes their real IDs into a gitignored `wrangler.local.jsonc` (bootstrapped
from the committed placeholder `wrangler.jsonc`). The two queues and the second
KV namespace are not created by it, and `wrangler.jsonc` carries a placeholder id
for `OAUTH_KV`. Create them yourself before the first deploy:

```bash
npx wrangler queues create openinspection-cron
npx wrangler queues create openinspection-word-export
npx wrangler kv namespace create openinspection-oauth   # then paste the id over the
                                                        # OAUTH_KV placeholder in
                                                        # wrangler.local.jsonc
```

Durable Objects, the Workflow, `BROWSER`, `IMAGES` and `STREAM` are name-only
bindings — declaring them in the config is all the provisioning they need.

> **`IMAGES` is optional.** The committed `wrangler.jsonc` declares it (an
> account-scoped, name-only binding). If your account has **Images →
> Transformations** enabled (the Free plan includes 5,000 transformations/month),
> Word exports embed downscaled ~960px JPEGs. If it is not enabled, the deploy
> still succeeds, `env.IMAGES` is simply unset, and the Word-export consumer
> embeds originals up to a hard byte budget (photos beyond it are omitted) so a
> large report never exceeds the isolate memory limit.

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be >= 32 random characters.            |
| `SETUP_CODE`      | First-run setup only — any value >= 6 characters; gates `/setup` (fail-closed if unset). |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — read by the Advanced-settings "Test connection" diagnostic. AI features themselves run on the tenant's own key stored via Settings → Advanced → AI (or, in `saas` mode only, `AI_MANAGED_API_KEY`). |
| `AI_MODEL`        | Required for any AI feature — the model id every AI call uses, in the chosen backend's own naming. Through an AI gateway that is `{provider}/{model}`. There is no compiled-in default; unset means AI fails closed with a 503. A company may override it for itself. |
| `AI_BASE_URL`     | Required for any AI feature — the root of the OpenAI-compatible API every AI call posts to. Point it at a hosted provider, at an AI gateway, or at an address on your own network running Ollama or vLLM. No compiled-in default; unset fails closed. A company may override it for itself. See [AI](../integrations/ai.md). |
| `AI_MANAGED_API_KEY` | Optional, `saas` only — a deployment-provided AI key for tenants the deployment grants managed access to. A standalone deploy has no managed path and ignores it. |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy the Worker

```bash
npm install
npm run setup:cloudflare   # provisions D1/KV/R2 + writes real IDs to wrangler.local.jsonc
npm run deploy             # build + wrangler deploy (uses wrangler.local.jsonc)
```

`npm run deploy` is the whole chain, in this order: `build` → `db:migrate:remote` → `db:lag` → `wrangler deploy` → `jwt:ensure` → `setup-code:ensure`. So **remote D1 migrations are applied by the deploy itself** — you do not need a separate `npm run db:migrate:remote` first, though running it on its own is a way to read the migration output before the build starts. `db:lag` sits between the migration and the deploy and aborts if the database and this checkout disagree about what has been applied. The build bakes whichever wrangler config wins (`WRANGLER_CONFIG` env > `wrangler.local.jsonc` > committed `wrangler.jsonc`).

> **One-click**: the committed `wrangler.jsonc` carries placeholder IDs; the README's *Deploy to Cloudflare* button provisions resources and injects real IDs automatically — no manual `setup:cloudflare` needed for that path.

### First-run setup code

First-run `/setup` is gated **solely** on the `SETUP_CODE` secret — the server reads `c.env.SETUP_CODE` and refuses to proceed when it is unset, so an unprotected Worker can't be claimed. It is any value >= 6 characters (compared for exact equality — no digit/charset constraint). You get one of two ways depending on how you deployed:

- **CLI** (`npm run deploy`): the final `setup-code:ensure` step (`scripts/ensure-setup-code.mjs`) generates a random `SETUP_CODE` and **prints it in the deploy output** — but only when the secret is MISSING. It never overwrites an existing value, so re-deploys keep your code. Provide your own first with `wrangler secret put SETUP_CODE` if you prefer.
- **One-click**: the wizard reads `.dev.vars.example` and surfaces `SETUP_CODE` as a secret field you fill in during deploy.

Then visit `https://<your-worker>.workers.dev/setup` and enter that value to bootstrap your first admin account.

### Publish the agent terms

The agent portal is **off until the deployment publishes a document written for
agents**, and nothing inside the product turns it on. A deployment that has not
published such a document cannot record anyone's agreement to one, so
`POST /api/agent-signup` refuses and the signup page closes itself. This is a
deployment-level document (`deployment_legal_versions`, doc `agent_terms`), not a
per-workspace one: no workspace administrator can supply it, and the gate does not
branch on `APP_MODE`, so a `saas` deploy needs it exactly as a self-hosted one does.

```bash
npm run agent-terms:publish -- --version YYYY-MM-DD            # local D1
npm run agent-terms:publish -- --version YYYY-MM-DD --remote   # remote D1
```

The tracked `app/content/legal/agent-terms.md` is a **template**: §1 names the
counterparty as "{{OPERATOR_NAME}} … which operates this deployment", and who that
is differs for every deployment. Write your own body to
`app/content/legal/agent-terms.local.md` instead — it is gitignored beside
`wrangler.*.jsonc` and `.dev.vars*` for the same reason, and the publisher prefers
it when present:

```bash
cp app/content/legal/agent-terms.md app/content/legal/agent-terms.local.md
# fill the operator fields, clear the draft status line, then publish
```

Editing the tracked template instead would make every deployment built from this
repository publish terms naming whoever edited it, and leave you carrying the
change as a permanent local diff. The header line the publisher prints names
whichever file it actually read, so a publish never leaves you guessing which text
was hashed.

`--version` is the date the text was **approved**, not today: it is shown to every
signer and stored on every acceptance, so deriving it from the clock would stamp
the deploy date onto a document approved on another day.

The script refuses rather than publish something half-finished. It strips HTML
comments first (the review status and the open questions live in comments so they
travel with the text under review without reaching a signer), then rejects a body
that still contains a `{{PLACEHOLDER}}`, or whose status line still says draft.
A liability cap reading `{{LIABILITY_FLOOR}}` is worse than no cap, because it
reads as a term. Publishing is idempotent on the **content hash**: the same words
published twice return the existing version, and changing the body under an
already-published version string is refused, because a version people accepted
cannot come to mean different words.

> **Symptom if you skip this**: everything else works and nothing logs an error,
> but agents reach *"Agent sign-up is not available yet"* with no way forward, and
> the agent portal stays unreachable for every workspace on the deployment.

### How the single worker is wired

The Worker entry at `workers/app.ts` is a Hono app. It routes API-owned paths (`/api/*`, `/status`, `/sign/*`, …) to the API app (`server/`) in-process, and sends every other path to React Router via `createRequestHandler` with `import("virtual:react-router/server-build")`, passing `{ cloudflare: { env, ctx } }` as the `AppLoadContext`. Before delegating to SSR it injects an in-process `API_WORKER` self-binding so React Router loaders/actions call the API app directly — no network hop, no second worker. `@cloudflare/vite-plugin` integrates the React Router SSR build with wrangler, so the standard `wrangler deploy` pipeline ships everything.

### Local development

```bash
npm run dev:hmr      # Vite dev server with HMR (react-router dev, port 5173) — fast iteration
npm run dev          # build-based: react-router build + wrangler dev (one worker, port 8787)
```

`npm run dev:hmr` is the everyday loop: instant hot updates for `app/` edits, and `server/` changes load through the worker entry's lazy API import. `npm run dev` is build-based (no HMR) and runs the real bundled worker on workerd — use it to verify production-shape behavior. Apply local D1 migrations first with `npm run db:migrate`. Note for contributors touching `workers/app.ts`: the entry must keep its top-level import graph tiny (the API is dynamically imported) — a static server import breaks the Vite dev runtime's export-type evaluation.

## Data retention & R2 lifecycle

OpenInspection is designed as a long-term evidence archive for inspectors — there is **no automatic deletion** of inspection data. Physical deletion happens only when an operator/integration explicitly purges a tenant (see *Tenant offboarding* below). To keep long-tail storage cheap without losing data, configure an R2 **lifecycle rule** on the `PHOTOS` bucket that transitions objects to the **Infrequent Access** storage class once they age past 365 days. This is a deploy-time/dashboard operation — no application code is involved.

- **Effect**: objects ≥ 365 days old move to Infrequent Access (~⅓ the storage cost). Reads still work transparently (a per-GB retrieval fee applies, latency is unchanged).
- **No expiry rule**: do NOT add a delete/expiry lifecycle action — that would erase evidence. Only the *transition* action is wanted.
- **D1 is untouched**: D1 has no storage classes and the row volume is small, so no lifecycle is needed there.

Configure it once per environment:

```bash
# Dashboard: R2 → PHOTOS bucket → Settings → Object lifecycle rules → Add rule
#   Action: "Transition to Infrequent Access", Age: 365 days, scope: whole bucket.

# Or via Wrangler:
wrangler r2 bucket lifecycle add PHOTOS ia-after-365d \
  --ia-transition-days 365
```

> A hosted/managed deployment runs the same rule on its own `PHOTOS` bucket. Self-hosters who do not want Infrequent Access can simply skip this step — it is a cost optimization, not a correctness requirement.

### Deleting an inspection

Deleting an inspection removes its database rows, its objects in the `PHOTOS` bucket and, when the `INSPECTION_DOC` Durable Object is bound, the collaborative document storage behind each of its reports. The Durable Object step runs last and is best effort: if it fails the inspection is still deleted, a warning naming the inspection id appears in the Worker logs, and the `inspection.delete` audit event carries `collabPurge: "failed"` (`"ok"` on success, `"skipped"` when the binding is absent or the inspection had no report). There is no automatic retry.

Two things to know when you operate native clients:

- **Local copies on devices.** The native client removes its copy of a deleted inspection when it next reconciles with the server (the device side is implemented by the native client, not by this repository), so the guarantee starts at that device's next successful connection. A device that stays offline keeps its copies until it connects or until it locks after `offline_max_days`. A copy holding unuploaded data is quarantined for export or removal instead of being deleted. Screenshots, the camera roll and exported packages are outside what the app can remove. See [`../develop/native-clients.md`](../develop/native-clients.md).
- **Known leftover.** Collaborative document storage of inspections deleted before this purge existed may remain. Durable Objects cannot be enumerated and the report ids of those deletions were not recorded, so it cannot be swept.

### Importing an offline package

When a device cannot sync, the native app can export what it holds as a `.zip`
package. An owner or a manager brings it in on **Settings → Offline packages**
(`/settings/offline-packages`). The page works with the ordinary web session and
does not need `NATIVE_CLIENT_ENABLED`. An inspector imports from the native app
instead, which signs in with the `native` scope and therefore needs that switch (see
[`../develop/native-clients.md`](../develop/native-clients.md), section 1).

1. Choose the file. The page reads a summary in the browser (inspections, queued
   changes, photos, who exported it and when) and tells you whether the package was
   exported for this company. Nothing is uploaded yet.
2. Review and confirm. The package is then sent in as many requests as it needs;
   keep the page open until it finishes.
3. Read the result: how many inspections were imported, how many queued changes
   were skipped because they had been applied before, and which inspections were
   left behind.

**Importing is safe to repeat.** Send the same file again and anything already
applied is skipped, so an interrupted import, a retry after fixing a cause and a
second person importing the same file all end in the same state. A queued change is
applied only once; a later edit made in the meantime is not overwritten by a repeat.

**Why an inspection is left behind.** A refusal about one inspection does not stop
the others. The page lists each inspection that was not imported with the reason and
the status and code of the answer behind it:

| Reason shown | Meaning | Next step |
|---|---|---|
| Not found | The inspection does not exist in this company and the package does not create it | Check that it was not removed; keep the downloaded part |
| Not allowed | The signed-in person cannot edit that inspection | Have an owner or manager who can open it import that part |
| Different report | The report in the package is not the report the inspection has now | Have the person who exported it check which report is current, then import again |
| Deleted | The inspection was deleted after the package was exported | Nothing to import; keep the part only if you still need its data |
| Change refused | The server could not apply the inspection's data or one of its queued changes | Import the part again later; if it keeps failing, give the part and the answer shown to whoever runs the deployment |
| Not confirmed | The server did not confirm the part in time | Nothing was lost; import the same file again |
| Too large | The inspection alone is larger than the server accepts in one request | Export it again from the app with fewer photos |
| Package refused | The package as a whole was refused: another company, older than the age limit, dated ahead of the server clock, or an expired session | Fix the cause (sign in to the right company, correct the device clock, export again) and import again |

A queued change that the server refuses inside an accepted package is listed
separately as a refused change: the inspection's results and photos were still
imported, and the change is not sent again.

Every left-behind inspection, and every group of them, can be downloaded as a
package of its own. The file you chose is never changed, so nothing is lost by a
failed import.

**A package is plaintext.** It is not encrypted and it holds client personal
information: names, addresses, contact details and photos. Whoever holds the file
is responsible for keeping it safe and for deleting it once it has been imported
(and any downloaded part once it is no longer needed). Treat it like an export of
the client list: keep it off shared drives and out of email.

**Size limits.** One request carries a bounded amount of work, set by the
`NATIVE_IMPORT_*` variables (inspections, queued changes, photos, entries and bytes
per request; defaults and allowed ranges are in the table in
[`../develop/native-clients.md`](../develop/native-clients.md), section 10). The page
cuts a larger package into parts that fit and sends them one at a time, so you do
not need to split a file by hand. A file larger than the most the request-size
limit can ever be raised to (24 MiB) is refused in the browser before it is sent;
a smaller one that is over your deployment's limit is cut into parts. Keep the defaults unless you have checked
the platform's current CPU-time and subrequest limits for your plan.

A package more than 400 days old, or dated more than a day ahead of the server
clock, is refused whatever its size.

### Tenant offboarding (export then purge)

When a tenant is offboarded, the platform first builds a **full data export** ZIP (CSV/JSON of inspections, templates and agreements **plus the photo bytes themselves** under `photos/`, size-bounded so large tenants stay within Worker memory limits; any object beyond the budget is listed in `photos-manifest.json` with `included: false`), then purges all tenant rows, R2 objects and KV keys. The purge writes a durable, non-personal **destruction record** (`tenant_destruction_records`: tenant id, row/object/byte counts, timestamp) that intentionally has no foreign key to `tenants` so it survives the deletion as compliance proof. These run via the integration endpoints `POST /api/platform/tenants/:slug/data-export` and `.../purge`.
