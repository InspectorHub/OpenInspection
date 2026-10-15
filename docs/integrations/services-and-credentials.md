# Outside services and credentials

A reference for the person who runs the deployment. It lists every outside
service the engine can talk to, whether it is optional, what happens without
it, where its credential goes, and who has the relationship with the vendor.

In a self-hosted deployment the answer to the last question is always the same:
**you do.** You open the accounts, accept the vendor's terms, pay the vendor and
answer to the vendor's rules. The engine only holds the credential and makes the
calls. Each service also has its own page with the detail; this page is the map
that puts them side by side.

## Two places a credential can live

| Place | Who sets it | How |
|---|---|---|
| **The Worker environment** | The operator (whoever can deploy the Worker) | `wrangler secret put NAME`, or a `vars` entry in `wrangler.local.jsonc`. See [`../operate/deploy.md`](../operate/deploy.md) |
| **Settings, saved by a company** | A company's owner or manager, in the app | Stored encrypted at rest, never shown again (the form shows a masked placeholder), and the save is audited by key name only |

The environment variable name and the Settings field are the same name for every
credential that can live in both places.

**Which one wins.** For most services the Worker environment wins, and a value
saved in Settings is used only when the environment variable is empty. That lets
an operator set a default for everyone while still letting a company fill the
gap on a deployment the operator cannot easily redeploy. Two groups invert the
rule, because a shared value there would send one company's money or reports to
another company's account:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- ISN: `ISN_DOMAIN`, `ISN_COMPANY_KEY`, `ISN_ACCESS_KEY`, `ISN_SECRET_KEY`

For those, the company's saved value always wins.

Three things to know about the merge:

- It applies to requests made through the app's API. Background jobs and a few
  services read their credential through their own lookup instead (email, SMS,
  AI and Google Calendar do; QuickBooks does for its scheduled sync), and the
  per-service sections below say which.
- **Inbound webhook endpoints (`/webhooks/...`) read their verification secrets
  from the Worker environment.** At the time of writing, a Stripe or QuickBooks
  webhook secret saved only in Settings is not merged on those routes. Set
  `STRIPE_WEBHOOK_SECRET` and `QBO_WEBHOOK_SECRET` as Worker secrets to be safe.
  This was read from the code, not exercised end to end.
- Changing a Worker secret needs a deploy or a `wrangler secret put`; a Settings
  value is changed in the app.

## What is required, and what is not

Required for the engine to run at all: the D1 database (`DB`), the KV namespace
(`TENANT_CACHE`), the R2 bucket for photos and files (`PHOTOS`), and the JWT
keyring and `JWT_SECRET` (see [`../operate/deploy.md`](../operate/deploy.md) and
[`../operate/rotate-jwt-keyring.md`](../operate/rotate-jwt-keyring.md)). These
live in your own Cloudflare account.

Everything else below is optional. The engine runs with none of it configured;
each section says what you lose.

## The services

Settings locations are where each form lives today. The environment variable
names are the stable part.

### Cloudflare account services

| Binding | Used for | Without it |
|---|---|---|
| `DB`, `TENANT_CACHE`, `PHOTOS` | Data, cache, photo and file storage | Required |
| `CRON_QUEUE`, `WORD_EXPORT_QUEUE` | Background jobs, Word export | Background work and Word export do not run; the export route answers 503 |
| `BROWSER` | Rendering reports to PDF | Report PDF rendering depends on it. This page does not document the exact behaviour when the binding is absent |
| `IMAGES` | Downscaling photos before they are embedded in a Word export | The export falls back to a fixed size budget and omits photos beyond it |
| `SIGN_COMPLETION_WORKFLOW`, Durable Objects (`INSPECTION_DOC`, presence, MCP) | Signing completion, live co-editing, presence, the MCP server | Collaborative editing falls back to a single editor; see [`../concepts/collab-editing.md`](../concepts/collab-editing.md) |
| `STREAM` | Video stored in Cloudflare Stream (see Video below) | Video stays in R2 |

Vendor relationship: you and Cloudflare. Costs: your Cloudflare account.
Data: everything the engine stores lives in your Cloudflare account.

### Email

- **What it does.** Sends every transactional message: password resets, report
  delivery, agreements, invoices, booking confirmations. Providers: Resend
  (default), SendGrid, Postmark, Mailgun. HTTPS APIs only; SMTP is not supported.
- **Optional.** Yes, but without it nothing is emailed. With no API key a send is
  skipped and a warning is logged (it does not raise an error). With no sender
  address a send fails with an error.
- **Credential.**
  - Operator level: `RESEND_API_KEY` and `SENDER_EMAIL` in the Worker environment.
    This is the default path.
  - Company level: Settings → Communication → Email. A company can choose its own
    provider and keys (`RESEND_API_KEY`, `SENDGRID_API_KEY`,
    `POSTMARK_SERVER_TOKEN`, `MAILGUN_API_KEY` with `MAILGUN_DOMAIN`) and its own
    sender address. The company's own settings are used only when the mode is set
    to your own provider **and** that provider's credentials are complete and a
    sender address is set. If they are incomplete, sending falls back to the
    operator-level key without an error, and the log records a warning.
- **Vendor relationship.** Whoever owns the key in use: the operator for the
  environment key, the company for its own.
- **Compliance.** The sender domain must be verified with the email provider
  (SPF and DKIM) by whoever owns that provider account. The engine adds an
  unsubscribe link and a suppression list fed by provider bounce and complaint
  webhooks.
- **Data sent.** Recipient addresses, subject, body and any attachment, such as a
  report PDF.
- Details: [`email.md`](email.md).

### SMS

- **What it does.** Appointment reminders, report-ready notices, consent
  confirmations. Providers: Twilio, Telnyx. Every message goes through one gate
  chain (consent, opt-out, quiet hours).
- **Optional.** Yes. With no credentials nothing is sent. Notifications that have
  an email path use email instead; the rest are not offered.
- **Credential.**
  - Operator level (Twilio only): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
    `TWILIO_FROM_NUMBER` in the Worker environment.
  - Company level: Settings → Communication → SMS. Twilio takes the same three
    values. Telnyx takes `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` and
    `TELNYX_PUBLIC_KEY` (the public key verifies inbound webhooks) and works only
    from the company's own settings. The company's own credentials take effect
    when the SMS mode is set to your own account and the whole set is present.
- **Vendor relationship.** Whoever owns the account: operator or company.
- **Compliance registration.** Sending SMS to US numbers is regulated. Carrier
  registration of your brand and campaign, the wording of your opt-in and quiet
  hours are the sender's responsibility and nothing is delivered reliably without
  them. Read [`../operate/sms-compliance.md`](../operate/sms-compliance.md) first.
- **Data sent.** The recipient's phone number and the message text.
- Details: [`sms.md`](sms.md).

### AI (translation and drafting)

- **What it does.** Translation and drafting assistance in the editor, through
  one adapter for any OpenAI-compatible endpoint.
- **Optional.** Yes, and it is off until configured. `AI_MODEL` and `AI_BASE_URL`
  have **no defaults**: with either unset the AI features fail closed with a 503,
  because a built-in destination would send inspection text somewhere nobody
  chose. A company may set its own endpoint and model in Settings; whether that
  alone is enough when the environment values are empty was not verified for this
  page, so set both in the environment.
- **Credential.**
  - Operator level: `AI_BASE_URL` and `AI_MODEL` in the Worker environment.
  - Company level: Settings → Advanced → AI. The API key is stored per company
    (`GEMINI_API_KEY`, an old name that now holds a key for whichever provider you
    use). The key is read from the company's saved settings only; an environment
    variable of that name is not used to run AI calls. Saving a new key asks the
    admin to confirm that they have reviewed their provider's terms and that their
    account's service level permits the intended use; the confirmation is kept
    with the key.
- **Vendor relationship.** The company with its AI provider. You can point
  `AI_BASE_URL` at a model on your own network, in which case inspection text sent
  to that endpoint does not need to leave that network.
- **Data sent.** Listed field by field in
  [`../compliance/ai-data-flow.md`](../compliance/ai-data-flow.md).
- Details: [`ai.md`](ai.md).

### Video

- **What it does.** Stores and plays inspection video clips. Default: your R2
  bucket. Optional: Cloudflare Stream (adaptive playback, posters, metadata
  removal on transcode).
- **Optional.** Yes. R2 is the default and needs nothing extra.
- **Credential.** To use Stream: a **Cloudflare Stream subscription on your own
  Cloudflare account** (charged by Cloudflare under its own terms; this repository
  states no figures), the `STREAM` binding in your Wrangler configuration, and
  your Stream customer subdomain (the part before `.cloudflarestream.com`, for
  example `customer-abc123`), entered in Settings → Integrations → Video. The
  subdomain is stored per company. If Stream is selected but the binding or the
  subdomain is missing, video requests fail with 503; they do not silently fall
  back to R2.
- **Vendor relationship.** You and Cloudflare.
- **Data sent.** With Stream, video goes from the browser straight to Cloudflare
  using a one-time upload address; the bytes do not pass through your Worker.
- Details: [`video.md`](video.md).

### Photos and files (R2)

Stored in the `PHOTOS` bucket in your Cloudflare account, under keys that begin
with the company id. Required. There is no separate credential: access is the
Worker's binding. Photo and video uploads need a connection; offline the editor
declines them.

### QuickBooks Online

- **What it does.** Pushes customers, invoices and refunds to QuickBooks Online and
  reads payment status back.
- **Optional.** Yes. Without credentials the connect flow stops and says what is
  missing.
- **Credential.** Your own Intuit developer app: `QBO_CLIENT_ID`,
  `QBO_CLIENT_SECRET`, `QBO_WEBHOOK_SECRET` and `QBO_ENV` (`sandbox` or
  `production`; there is no default). Set them in the Worker environment or in
  Settings → Integrations → QuickBooks Online. The environment wins; a company can
  fill the gap in Settings. `APP_BASE_URL` must also be set to the exact public
  origin, because Intuit matches the redirect address byte for byte.
- **The connection itself** is a company's own QuickBooks company, authorized by
  the person connecting it. One QuickBooks company can be connected to one
  company here.
- **Vendor relationship.** The operator (or the company that supplied the app
  credentials) with Intuit for the developer app; the company with Intuit for its
  QuickBooks subscription. Production keys need Intuit's own app review.
- **Data sent.** Contact names, emails and phone numbers, invoices, payments and
  refunds.
- Details: [`quickbooks.md`](quickbooks.md).

### Stripe (card payments)

- **What it does.** Lets a company take card payments and booking deposits from
  its own clients.
- **Optional.** Yes. Without it invoices can still be marked paid by hand
  (cheque, cash, transfer) and the report payment gate releases on that.
- **Credential.** The company's **own** Stripe account: `STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, saved in Settings →
  Integrations (and Advanced). A company's saved key always wins over an
  environment variable. Do not set a Stripe secret key in the Worker environment of
  a deployment that serves more than one company. Point your Stripe webhook at
  `https://<your-host>/webhooks/stripe`; the webhook secret is read from the Worker
  environment (see above).
- **Vendor relationship.** The company and Stripe. Fees, disputes and refunds are
  the company's.
- **Data sent.** The details needed to create a payment: amount, currency and the
  invoice reference.
- Details: [`stripe.md`](stripe.md).

### Google Places and Google Maps

- **What it does.** Address suggestions on the booking page and in the new
  inspection wizard (Places), address lookup used when deciding which inspector is
  closest, and an interactive map marker (Maps JavaScript).
- **Optional.** Yes. Without a Places key the address field is plain text and
  booking still completes. Without the Maps key the map is not drawn.
- **Credential.**
  - `GOOGLE_PLACES_API_KEY`: Worker environment, or Settings → Advanced. The key
    is used only from your Worker; the browser never sees it. Restrict it by API
    and, where you can, by address.
  - `GOOGLE_MAPS_JS_API_KEY`: Worker environment only. **This key is sent to the
    browser** because the map runs there, so it must be restricted to your site's
    HTTP referrers in Google Cloud.
- **Vendor relationship.** The operator (or the company that saved the key) with
  Google.
- **Data sent.** The part of an address a person has typed, from your Worker to
  Google. With the Maps key, the visitor's browser also contacts Google directly.
- Details: [`google-places.md`](google-places.md).

### Estated (property facts)

- **What it does.** Fills year built, size, foundation and similar fields from
  public records when an inspector presses the button.
- **Optional.** Yes. Without a key the card says auto-fill is not configured and
  manual entry works.
- **Credential.** `ESTATED_API_KEY`: Worker environment, or Settings → Advanced.
- **Data sent.** The property address.
- Details: [`estated.md`](estated.md).

### Calendars

- **Google Calendar.** Each inspector connects their own calendar. The deployment
  needs a Google OAuth client: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, from a
  Google Cloud project with the Calendar API enabled, set in the Worker environment
  or in Settings → Communication → Calendar. Add your deployment's callback as an
  authorized redirect URI. Without it there is nothing to connect and scheduling
  uses the app's own calendar. Data sent: busy times are read; inspections written
  back as events carry their time and address. Details:
  [`google-calendar.md`](google-calendar.md).
- **Apple Calendar (CalDAV).** No deployment-level credential. Each inspector
  enters their Apple ID and an app-specific password, which is stored encrypted.
  CalDAV has no read-only mode. Details: [`apple-calendar.md`](apple-calendar.md).
- **ICS feed.** The engine can publish a calendar feed that other
  calendar apps subscribe to. No outside account is involved.

### Turnstile (bot protection)

- **What it does.** A challenge on the public booking form and on agent signup.
- **Optional.** Yes, in a self-hosted deployment. With no secret key set, no
  challenge is shown. If your booking page is linked from a public website, set
  one.
- **Credential.** `TURNSTILE_SECRET_KEY` (Worker environment, or Settings →
  Security) and `TURNSTILE_SITE_KEY` (Worker environment; it is public). The
  committed configuration ships Cloudflare's always-pass test site key; replace it
  when you enable real protection.
- **Vendor relationship.** The operator and Cloudflare.
- **Data sent.** The challenge token, from your Worker to Cloudflare for
  verification.
- Details: [`turnstile.md`](turnstile.md).

### ISN

- **What it does.** Adds a published report's link to the matching ISN order.
- **Optional.** Yes. Without all four values nothing is synced.
- **Credential.** The company's own ISN access keys: `ISN_DOMAIN`,
  `ISN_COMPANY_KEY`, `ISN_ACCESS_KEY`, `ISN_SECRET_KEY`, saved in Settings →
  Advanced → ISN. The company's saved values always win. ISN keys do not expire
  and carry the full permissions of the ISN user who issued them.
- **Data sent.** The report link, attached to the order.
- Details: [`isn.md`](isn.md).

### MCP (inbound)

Not a dependency. It lets Claude or another MCP client drive your deployment over
OAuth 2.1, behind the `MCP_ENABLED` switch. No outside credential is involved.
Details: [`mcp.md`](mcp.md).

## Where a company can use its own account

A company inside your deployment can override the operator-level default for:

| Service | Company-level override | Where |
|---|---|---|
| Email | Own provider, keys and sender address | Settings → Communication → Email |
| SMS | Own Twilio or Telnyx account | Settings → Communication → SMS |
| AI | Own API key (endpoint and model optionally) | Settings → Advanced → AI |
| QuickBooks | Own Intuit app credentials | Settings → Integrations → QuickBooks Online |
| Google Calendar | Own Google OAuth client | Settings → Communication → Calendar |
| Google Places, Estated, Turnstile | Fill the gap when the environment value is empty | Settings → Advanced, Settings → Security |
| Stripe, ISN | Always the company's own account | Settings → Integrations, Settings → Advanced |

Where the environment value and the company value both exist, the precedence is
the one described at the top of this page. Email, SMS, Google Calendar and
QuickBooks can end up using the operator's credential when the company's set is
incomplete, so check the status shown on the settings page after you save.

## Who is responsible for what

| | Operator | Company admin | The vendor |
|---|---|---|---|
| **Credentials** | Creates the accounts, sets Worker secrets, rotates them | Saves and rotates keys for its own accounts in Settings (owner or manager only) | Issues and revokes keys |
| **Costs** | Pays Cloudflare and every vendor whose key is in the Worker environment | Pays every vendor whose account it supplied | Charges the account holder under its own terms |
| **Compliance registration** | Registers and verifies what the operator-level accounts need (email sending domain, SMS carrier registration, Intuit production review, Google consent screen) | Does the same for its own accounts; supplies business details a vendor asks for | Reviews and approves registrations; sets its own rules |
| **Data sent** | Chooses which services are enabled and where they point (for example the AI endpoint); documents the data flows for its own users and regulators | Decides what is sent: whom to email or text, which records to sync, which AI features to use | Processes what it receives under its own terms |
| **Failure and support** | Watches logs and the settings status; redeploys | Re-enters revoked keys; reconnects QuickBooks or calendars | Operates its service; its outages show as failed sends or lookups |

In a deployment with a single company the operator and the company admin are
usually the same person; the columns are still different jobs, because one needs
access to Cloudflare and the other needs only an account in the app.

## Related

- [Integrations index](README.md): the conventions common to every service
- [`../operate/deploy.md`](../operate/deploy.md): setting Worker secrets
- [`../operate/sms-compliance.md`](../operate/sms-compliance.md): read before sending SMS
- [`../compliance/ai-data-flow.md`](../compliance/ai-data-flow.md): what an AI call sends
- [`../develop/integration-adapters.md`](../develop/integration-adapters.md): changing this code
