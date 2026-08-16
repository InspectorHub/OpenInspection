# QuickBooks Online — connecting a self-hosted deployment

OpenInspection pushes customers, invoices and refunds to QuickBooks Online, and reads invoice payment status back. A self-hosted deployment connects through **its own Intuit app**, which you create once on Intuit's developer portal.

That is not a limitation of this build. Intuit matches an OAuth redirect URI **byte for byte** against the app it was registered on, and your deployment answers on your own domain — so no app but yours can complete the handshake against it.

---

## What you need

Four settings. Three are credentials from your Intuit app; the fourth says which Intuit environment that app belongs to.

| Setting | Where it comes from |
|---|---|
| `QBO_CLIENT_ID` | Intuit app → Keys & credentials |
| `QBO_CLIENT_SECRET` | the same page |
| `QBO_WEBHOOK_SECRET` | Intuit app → Webhooks → verifier token |
| `QBO_ENV` | `sandbox` or `production` — see below |

Set them either as Worker secrets (`wrangler secret put`) or in the app under **Settings → Integrations → QuickBooks Online**. **The Worker environment wins**; a stored value is the fallback, which is what makes the settings form useful on a deployment you cannot easily redeploy.

`APP_BASE_URL` must also be set, and must be the exact public origin your deployment answers on. It is what the redirect URI is built from.

### `QBO_ENV` is not optional and has no default

`sandbox` reaches `sandbox-quickbooks.api.intuit.com`; `production` reaches `quickbooks.api.intuit.com`. There is deliberately no default: a Development key authenticates only against sandbox companies and a Production key only against real ones, so a guessed host is wrong for one of them and fails in a way that reads like a bad credential.

If it is unset, the connect flow stops and the settings page says so explicitly rather than reporting a credential problem.

---

## Creating the Intuit app

1. Sign in at `developer.intuit.com` and create an app with the **com.intuit.quickbooks.accounting** scope.
2. Under **Keys & credentials**, copy the Client ID and Client Secret. Development keys are issued immediately; Production keys require Intuit's app assessment.
3. Register the **redirect URI** exactly:

   ```
   https://<your-domain>/api/integrations/qbo/callback
   ```

   It must be `https`. Intuit's console rejects `http://localhost` outright, so a plain local port cannot be registered — use a tunnel with an https origin if you need to test locally.

4. Register the **Disconnect URL**:

   ```
   https://<your-domain>/integrations/quickbooks/disconnected
   ```

   Intuit sends a user here after they disconnect your app from the QuickBooks side. The page is public and static by necessity: that redirect is a cross-site navigation and carries none of your session cookies.

5. Under **Webhooks**, register the endpoint and copy the verifier token:

   ```
   https://<your-domain>/api/integrations/qbo/webhook
   ```

   This is a **different path** from the redirect URI. Putting the callback URL in the webhook field is a common mix-up and produces an `invalid redirect_uri` error at authorize time, because the redirect URI was then never registered at all.

---

## Connecting

**Settings → Integrations → QuickBooks Online → Connect to QuickBooks.** After authorizing, the connect button is replaced by the connected company and a **Disconnect from QuickBooks** control.

Every outcome of the handshake is reported on that page, including the failures — a missing credential, an unset `QBO_ENV`, an expired attempt, or a declined authorization.

---

## What happens when a connection ends

Two things end a connection, and both leave the same state behind: no connection, no entity mappings, no open sync errors.

- **You disconnect**, from this app or from QuickBooks.
- **Intuit refuses the grant.** Access tokens last an hour and are refreshed automatically; the refresh token rotates on every refresh and is re-stored each time. If Intuit answers a refresh with `400` or `401`, the grant is genuinely gone and the connection is retired.

Any other refresh failure — a 5xx, a rate limit, a network error — leaves the connection intact, because none of those say anything about your token.

Mappings are cleared on purpose. Reconnecting can land on a **different** QuickBooks company, and a mapping that outlived its connection would still name entity ids belonging to the old one.

---

## Limits worth knowing

- QuickBooks **Online** only. The REST API this integration uses does not cover QuickBooks Desktop or Self-Employed.
- Intuit throttles per app **and** company: 500 requests per minute per company, and at most 10 concurrent requests to the same company.
- Two things are read back FROM QuickBooks: payment status, and whether an invoice was voided there. Everything else flows one way, out of OpenInspection.
- A void in QuickBooks is **recorded, not mirrored**. OpenInspection files it under Sync Errors and leaves the invoice as it was, because voiding here resets the inspection's payment gate and can retract a published report — a decision, not something a poll should make for you. If the void was intended, void it here too.
- QuickBooks rejects a colon in a customer's name, so the name sent over is the contact's with any colons removed. The contact's record here is unchanged.

---

## Related

- [Deploy](../self-host/deploy.md) — setting Worker secrets
- [Rotate secrets](../self-host/rotate-secrets.md)
- [Invoicing and payments](../user-guide/invoicing-and-payments.md) — what syncs, from the user's side
