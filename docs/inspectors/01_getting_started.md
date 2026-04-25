# Getting Started

This guide walks you through deploying OpenInspection and completing the initial setup.

---

## Option A: One-Click Deploy (Recommended)

Click the button below to deploy directly to your Cloudflare account. Cloudflare will automatically create a D1 database, R2 bucket, and KV namespace, then deploy the Worker.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/important-new/OpenInspection)

After the deploy completes:

1. Click **"View your deployment"** in the Cloudflare dashboard.
2. You will be redirected to `/setup` — the first-run wizard.
3. Fill in your company details and create your admin account.
4. You're taken to the **dashboard** and the system is ready.

> **Apply database migrations:** Before the setup wizard will work, you need to apply the database schema. In the Cloudflare dashboard, go to **Workers & Pages → your Worker → D1 → Migrations**, or run from your terminal:
> ```bash
> npx wrangler d1 migrations apply openinspection-db --remote
> ```

---

---

## Option B: Automated Terminal Setup (Recommended)

If you have clones the repository locally, run the automated setup script. It handles everything: resource creation, `wrangler.toml` configuration, secret generation, and first-time deployment.

```bash
npm install
npm run setup:cloudflare
```

The script will:
- Authenticate with Cloudflare.
- Create D1 Database, KV Namespace, and R2 Buckets.
- Apply database migrations.
- Generate a secure `JWT_SECRET`.
- Configure Turnstile keys.
- Deploy the Worker for the first time.

Visit the printed Worker URL — you will be redirected to `/setup` to create your master admin account.

---

## Option C: Manual Manual Steps (For Advanced Users)

If you prefer to create resources one-by-one:

### 1. Create resources

---

## First-Run Setup Wizard

The setup wizard at `/setup` runs once, when your database has no users. It collects:

| Field | Notes |
|---|---|
| **Company Name** | Displayed on the homepage and reports |
| **Workspace Subdomain** | Lowercase letters, numbers, and hyphens only |
| **Admin Email** | Your login email |
| **Admin Password** | At least 8 characters recommended |

After submitting, the wizard:
- Creates your tenant record and admin user
- Seeds a default inspection template
- Signs you in and redirects to the dashboard

The setup page is permanently disabled once an admin account exists.

---

## Connecting Your Domain

After deploying, point your custom domain at the Worker:

1. In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Settings → Triggers**.
2. Click **Add Custom Domain**.
3. Enter your domain (e.g., `inspections.smithhomeinspections.com`).

If you want subdomain routing for multi-user support (e.g., `smith.yourdomain.com`), add a wildcard route: `*.yourdomain.com/*`.

> **Self-Hosting on Apex Domain**: If you are a single inspector and want to host on your domain without subdomains (e.g., just `inspect.com`), set the `SINGLE_TENANT_ID` secret in Cloudflare. This enables **Apex Mode**.

---

## Logging In

### Production

Visit `https://<your-subdomain>.yourdomain.com/login` (or your custom domain). Enter your admin email and password. Your session is stored as an `inspector_token` cookie — you stay logged in across browser sessions.

### Local Development

There are two modes depending on what you need:

| Mode | URL | Behaviour |
|---|---|---|
| **Anonymous dev** | `http://localhost:8788` | No subdomain → falls back to `dev`. Tenant DB lookup is skipped entirely. Use this for UI work that doesn't depend on tenant-specific data. |
| **Real tenant** | `http://<subdomain>.localhost:8788` | Subdomain extracted from host, tenant looked up in local D1. Use the exact subdomain you entered in the setup wizard. Most browsers resolve `*.localhost` natively — no `/etc/hosts` change needed. |

> **Example:** if you set subdomain `acme` during setup, log in at `http://acme.localhost:8788/login`.

---

## Resetting Your Password

### Via email (production)

If `RESEND_API_KEY` and `SENDER_EMAIL` are configured:

1. Go to `/login` and click **Forgot password** (or call the API directly).
2. Submit your email to `POST /api/auth/forgot-password`.
3. You will receive an email with a reset link valid for **1 hour**.
4. The link opens `/login?reset_token=<token>`. Submit your new password to `POST /api/auth/reset-password`.

### Local development (no email)

In local dev `RESEND_API_KEY` is usually absent, so the reset link is printed to the **Wrangler console** instead of sent by email:

```
[RESET] admin@example.com → http://acme.localhost:8788/login?reset_token=<uuid>
```

Copy that URL, open it in your browser, and submit your new password.

### Manual reset via SQL (emergency)

If you cannot receive email and have no console access, you can overwrite the password hash directly in the local D1 database. Generate a SHA-256 hex digest of your new password and update the row:

```bash
# 1. Generate SHA-256 hash of your new password (replace "newpassword" with your actual password)
echo -n "newpassword" | sha256sum

# 2. Apply it to the local D1 database
npx wrangler d1 execute DB --local \
  --command "UPDATE users SET password_hash = '<paste-hash-here>' WHERE email = 'admin@example.com'"
```

For a remote (production) database replace `--local` with `--remote`.

---

## What's Next

- **[Managing Inspections](./02_managing_inspections.md)** — Create jobs, assign inspectors, track status
- **[Field Collection](./03_field_collection.md)** — Use the mobile form on-site
- **[Reports & Payment](./04_reports_and_payment.md)** — Deliver reports and collect payment
- **[Team Management](./05_team_management.md)** — Invite inspectors and agents
- **[Booking System](./06_booking_system.md)** — Accept online booking requests
