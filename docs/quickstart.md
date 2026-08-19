# Quickstart — a working deployment in about 20 minutes

The shortest honest path from an empty Cloudflare account to a running
inspection workspace you can log into. It skips every production decision that
can be made later; [`operate/deploy.md`](operate/deploy.md) is where those live.

At the end you will have a deployed Worker, an admin account, and one inspection
you created yourself — which is what proves the deployment works, rather than a
green deploy log.

---

## 1. What you need before you start

| Requirement | Why |
|---|---|
| A Cloudflare account | The whole stack runs on it — one Worker plus D1, KV and R2. The Free plan is enough to finish this guide. |
| Node.js ≥ 22.22.0 | The version this repository builds against (`engines.node` in `package.json`). Only needed for the CLI path below. |
| `wrangler login` | The CLI path provisions resources in your account and deploys with your credentials. Only needed for the CLI path. |

Nothing else. There is no separate database server, no container, no queue to
stand up: the [architecture](develop/architecture.md) is a single Worker.

---

## 2. Get it deployed

Two paths. They produce the same deployment; pick by whether you want a local
checkout.

### One-click

Use the **Deploy to Cloudflare** button in the [README](../README.md). Cloudflare
forks the repository, reads the committed `wrangler.jsonc` — which carries
placeholder resource IDs only — and provisions and binds D1 (`DB`), KV
(`TENANT_CACHE`), R2 (`PHOTOS`), the `BROWSER` binding, the Durable Objects and
the Workflow, injecting the real IDs for you. You never edit an ID by hand.

The wizard reads [`.dev.vars.example`](../.dev.vars.example) and asks you for
`SETUP_CODE` as a secret field during the deploy. Write down what you type —
section 3 needs it.

### CLI

```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare   # provisions D1/KV/R2 and writes real IDs into a gitignored wrangler.local.jsonc
npm run deploy             # build, apply remote migrations, deploy, then provision missing secrets
```

Use `npm run deploy`, not raw `wrangler deploy`: the npm script runs the full
`react-router build` (bundling the `server/` API and the `app/` SSR into one
Worker), applies remote D1 migrations, and only then deploys. Its tail runs two
idempotent ensure-steps that provision the JWT keypair and a `SETUP_CODE` if one
is missing — and **prints that code in the deploy output**. It never overwrites a
code you set yourself, so re-deploys keep it.

Confirm the Worker is up before going further:

```bash
curl https://<your-worker>.workers.dev/status
```

It answers with `status: "ok"` and the version, commit and build time of what is
actually running — useful later for telling a stale deploy from a broken one.

---

## 3. Claim the deployment: `SETUP_CODE` and `/setup`

Visit `https://<your-worker>.workers.dev/setup` and fill in your company name,
your name, an email address, a password, and the `SETUP_CODE`. That creates the
first workspace and its admin account, and logs you in.

Two things about this door are worth understanding, because both are deliberate:

- **It is gated solely on the `SETUP_CODE` secret, and it fails closed.** When
  the secret is unset the endpoint refuses with `setup_code_unset` rather than
  letting the request through. A Worker you deployed but have not finished
  configuring therefore cannot be claimed by whoever finds the URL first. The
  code is any value of at least six characters, compared for exact equality.
- **It is one-time.** Once a tenant-scoped user exists the endpoint answers
  `409 already_initialized` and stops. You do not have to remember to turn the
  door off; it closes behind you. You can rotate or remove the secret afterwards
  from the Cloudflare dashboard under **Settings → Variables and Secrets**.

If you lost the code: set a new one with `wrangler secret put SETUP_CODE` and
reload `/setup`.

---

## 4. Prove it works end to end

A deploy that returns HTTP 200 has proved that a Worker starts. It has not
proved that D1 accepts a write, that R2 is bound, or that the SSR routes render.
Creating one inspection touches all three.

1. From the dashboard, open **Inspections** and choose **New Inspection**.
2. Enter a property address, pick yourself as the inspector, and save.
3. Open the inspection and start the editor. Add one finding with a photo.

If the finding and its photo survive a page reload, D1 and R2 are both wired
correctly and you have a working deployment. If the photo does not appear, the
`PHOTOS` R2 binding is the first thing to check.

Delete the inspection afterwards, or keep it — a workspace starts pre-loaded
with starter templates and canned comments, so there is nothing to clean up
before real work begins.

---

## 5. Where to go next

| You want to… | Go to |
|---|---|
| Set this up for production rather than for a first look | [`operate/deploy.md`](operate/deploy.md) — required resources, the full secret table, R2 lifecycle, backups |
| Move an existing deployment to a newer release | [`operate/upgrade.md`](operate/upgrade.md) |
| Send email or SMS, connect QuickBooks, a calendar, or AI | [`integrations/README.md`](integrations/README.md) — one page per service, including what breaks when it is not configured |
| Send text messages to clients in the US or Canada | [`operate/sms-compliance.md`](operate/sms-compliance.md) — carrier registration and the wording your Privacy and Terms pages need |
| **Learn the product itself** — creating inspections, writing and publishing reports, agreements, invoicing | **<https://inspectorhub.io/docs>** |

That last row is not a redirect to a sales site: the product documentation is the
same for a deployment you run and one somebody runs for you, so it is written
once and serves both. This repository documents the engine — deploying it,
operating it, changing it, integrating it. What differs between the two ways of
running it, capability by capability, is
[`reference/deployment-modes.md`](reference/deployment-modes.md).
