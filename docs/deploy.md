# Deploying OpenInspection

This guide covers self-hosted production deploys — what every adopter does to run the engine for their own inspection business.

---

## Self-hosted production deploy

The recommended path is the one-click button in the README:

```
[Deploy to Cloudflare] → fork → run `npm run setup:cloudflare`
```

For the manual flow, see [`docs/developers/06_deployment.md`](./developers/06_deployment.md).

### Required Cloudflare resources

| Resource         | Binding         | Purpose                                                    |
|------------------|-----------------|------------------------------------------------------------|
| Workers          | (the worker)    | The engine itself.                                         |
| D1 database      | `DB`            | All structured data (inspections, users, comments, …).     |
| R2 bucket        | `PHOTOS`        | Field-form photo uploads.                                  |
| R2 bucket        | `REPORTS`       | Pre-rendered Summary + Full Report PDFs (Spec 5A).         |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |

`npm run setup:cloudflare` provisions every binding listed above and writes their IDs back into your local `wrangler.toml`. Re-run with `--refresh-setup-code` to mint a new first-run setup code if you misplace yours.

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be ≥ 32 random characters.            |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — enables AI comment-assist.               |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy + post-deploy

```bash
npm run deploy
# applies remote D1 migrations, rebuilds Tailwind, and ships the worker
```

After the worker boots, visit `https://<your-worker>.workers.dev/setup` and enter the 6-digit setup code printed in the deploy log. That bootstraps your first admin account.
