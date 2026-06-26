# Transactional Email Providers

OpenInspection sends transactional email through pluggable HTTP-API adapters. Each company (tenant) can use the platform's default provider or bring their own credentials. This guide covers the supported providers, how to configure them in Settings, and the platform-vs-own mode relationship.

> **SMTP is not supported.** Cloudflare Workers cannot maintain a stateful TCP connection, so every supported provider is a plain HTTPS REST API. If your preferred provider requires SMTP or STARTTLS, it will not work here.

---

## Supported providers

All providers listed below use HTTP REST APIs and are supported today.

| Provider | Where to get your key | Secret name(s) |
|---|---|---|
| **Resend** (default) | [resend.com](https://resend.com) → API Keys | `RESEND_API_KEY` (starts with `re_`) |
| **SendGrid** | [app.sendgrid.com](https://app.sendgrid.com) → Settings → API Keys | `SENDGRID_API_KEY` (starts with `SG.`) |
| **Postmark** | Postmark dashboard → Servers → your server → API Tokens ("Server Token") | `POSTMARK_SERVER_TOKEN` |
| **Mailgun** | [Mailgun](https://www.mailgun.com) → Settings → API Keys, plus a verified sending domain (e.g. `mg.yourdomain.com`) | `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` |

**Mailgun** requires two values: the API key and a verified sending domain. Both must be saved before the connection can be validated.

### Coming later

**Amazon SES** is a planned fast-follow. Its HTTP API requires AWS SigV4 request signing, which is not included in this release.

---

## Choosing a provider in Settings

1. Go to **Settings → Communication → Email**.
2. Select your provider from the **Email provider** dropdown.
3. Enter the credential field(s) shown for that provider (API key, server token, or key + domain for Mailgun).
4. Click **Save**.

Once saved, the provider takes effect immediately for all outgoing email from your company.

---

## Platform mode vs. own mode

The email system has two modes, controlled by the `email_mode` field on the company configuration:

| Mode | What it does |
|---|---|
| `platform` | Uses the operator's platform-level Resend key (set via the `RESEND_API_KEY` environment variable at deploy time). This is the default for a new company with no email configuration. |
| `own` | Uses the company's own stored provider and credentials (selected in Settings → Communication → Email). |

The active provider is `email_byo_provider`, which can be `resend`, `sendgrid`, `postmark`, or `mailgun` (default: `resend`). This field is only consulted when `email_mode` is `own`.

**Fallback behavior:** if `email_mode` is `own` but the selected provider's credentials are missing or incomplete, the system falls back to the platform Resend path. A partially configured company continues to send email — it does not fail silently or stop sending.

This means:
- A brand-new company always sends via the platform Resend key until you explicitly configure your own.
- Switching to `own` mode without completing the credentials form leaves email delivery unchanged (platform path stays active).

---

## Validating credentials

After saving, you can verify that your credentials are accepted by the provider:

- **Resend**: a **Test connection** button appears. It sends a request to verify the API key is valid and the sending domain is accessible.
- **SendGrid / Postmark / Mailgun**: a **Validate credentials** button verifies the stored key against the provider's API. No email is sent during validation.

Validation is optional but recommended, especially after rotating an API key.

---

## Self-hosting: platform default

For a self-hosted (standalone) deploy, the platform-default email path is the `RESEND_API_KEY` environment variable in your `wrangler.local.jsonc` (or `wrangler.saas.jsonc`):

```jsonc
// In wrangler.local.jsonc, under [vars] or as a secret:
// wrangler secret put RESEND_API_KEY
```

This key is used for all companies in `platform` mode. Companies that configure their own provider in Settings are unaffected by this env variable.

See the [environment variables table](../CLAUDE.md) or the project README for the full list of optional email-related env vars.

---

## What is not supported

| Not supported | Reason |
|---|---|
| SMTP / STARTTLS | Cloudflare Workers cannot open stateful TCP connections. |
| Amazon SES | Requires AWS SigV4 request signing — planned as a fast-follow, not in this release. |
