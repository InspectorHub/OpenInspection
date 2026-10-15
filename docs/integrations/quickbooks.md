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

On that page the section **Your Intuit app** holds the four settings and the three addresses to register in your Intuit app (redirect URI, disconnect URL, webhook endpoint), each with a copy button. It opens by itself while a setting is missing and folds to one line once everything is set. A setting the Worker environment supplies is listed as built in, with an **Override** for storing a value of your own as the fallback; the Intuit environment is a two-way control that stays unselected until you choose, and saving credentials never writes it for you.

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
   https://<your-domain>/webhooks/quickbooks
   ```

   This is a **different path** from the redirect URI. Putting the callback URL in the webhook field is a common mix-up and produces an `invalid redirect_uri` error at authorize time, because the redirect URI was then never registered at all.

---

## Connecting

**Settings → Integrations → QuickBooks Online → Connect to QuickBooks.** After authorizing, the connect button is replaced by the connected company and a **Disconnect from QuickBooks** control.

Every outcome of the handshake is reported on that page, including the failures — a missing credential, an unset `QBO_ENV`, an expired attempt, or a declined authorization.

### One QuickBooks company, one OpenInspection company

A QuickBooks company (its *realm*) can be connected to exactly one OpenInspection company. Connecting one that another OpenInspection company already holds is refused, and the page says so: disconnect it there first.

The reason is the webhook. It is a single unauthenticated endpoint shared by every connection — the path names no company — so after verifying the Intuit signature the only thing that says whose books an event belongs to is the realm id inside the verified payload. Two OpenInspection companies claiming the same realm would make that answer ambiguous, and an ambiguous answer would post one company's payments into whichever OpenInspection company happened to be found first. Rather than guess, such an event is skipped and logged with both claimants named.

---

## Checking the Intuit app's keys

**Settings → Integrations → QuickBooks Online → Your Intuit app → Check credentials** tells you whether the Client ID and Client Secret in force are a matching pair, without connecting anything. It posts an authorization-code exchange with a made-up code to Intuit's token endpoint: Intuit authenticates the client before it looks at the code, so a matching pair is answered with `invalid_grant` and a wrong ID or secret with `invalid_client`. Nothing is created or consumed either way.

What the check does **not** tell you:

- **Development or Production keys.** The token endpoint is shared by both and accepts both. A Development key set only reaches sandbox companies; see `QBO_ENV` above.
- **Whether the Redirect URI is registered.** The made-up code fails before the redirect address is compared.

Only an explicit `invalid_client` is reported as rejected. A timeout, a server error, a rate limit or an answer that is not Intuit's JSON is reported as "could not reach Intuit", because none of those says anything about the keys. The result carries a verdict and a time, never a credential. The check is limited to 10 requests per minute per company, and it is disabled while a field holds text that has not been saved yet, so it never reports on values the page is not using.

---

## What Sync now does

**Sync now** checks QuickBooks for invoices that changed since the last check and records any payments against the matching OpenInspection invoices. It waits for QuickBooks to answer, then says how many invoices were updated, and the page shows when it last checked. If QuickBooks cannot be reached, or automatic sync is switched off, it says so and the last-checked time does not move.

It does not send anything to QuickBooks. Contacts and invoices are sent when you create or update them (and invoices that were waiting on a match are sent again once you match the contact).

## Matching contacts to QuickBooks customers

A contact is matched to a QuickBooks customer the first time it is synced: by the email address when one matches, otherwise a new customer is created. When that cannot work, you can match by hand.

- **From an item that needs attention.** A contact that could not be sent shows **Match to a QuickBooks customer** on the QuickBooks settings page.
- **From the contact's page.** Owners and managers see a **QuickBooks** card once QuickBooks is connected, with **Match to a QuickBooks customer**, or **Change match** and **Remove match** when the contact is already matched.

The dialog searches active QuickBooks customers by display name, or by exact email when the text contains `@`. Searching happens when you press Enter or **Search** (at least two characters), not as you type, because searches are rate limited per company. A customer already matched to another contact is shown greyed out with that contact's name. An inactive customer cannot be matched.

Things to know:

- `%` and `_` in the search text act as wildcards for any characters. QuickBooks does not honour escapes inside its name search, so a search containing them returns a superset of what was typed.
- After a match, a contact's edits here update that QuickBooks customer's name, email and phone.
- Invoices of that contact that failed for lack of a customer are sent again in the background: at most ten per match, one at a time, none started after twenty seconds. Paid and part-paid invoices are left alone. What is left over is sent the next time the contact is matched or the invoice is sent again.
- **Remove match** changes nothing in QuickBooks. The next time the contact is synced, an existing customer with the same email is looked up first, and a new one is created if there is none.
- Archiving a contact keeps its match, and the customer stays unavailable to other contacts. An archived contact cannot be matched or changed, but its match can be removed from its page. Deleting a contact for good removes its match.
- Only owners and managers can match or remove a match.

The verifier token follows the same precedence as the other QuickBooks settings: the Worker environment wins, and the token saved in Settings → Integrations is the fallback (Stripe is the opposite: a workspace's saved value wins, see stripe.md). On a deployment with one fixed workspace the stored token is that workspace's. Where the path names no workspace, the realm id in the body is used only to choose which workspace's stored token to try; the Intuit signature must still verify against that token, and the events are then applied to that workspace alone. Another workspace's token cannot verify the payload.

The webhook endpoint refuses a body larger than 256 KB with `413` and, where the `QBO_WEBHOOK_RATE_LIMITER` binding is configured (`wrangler.jsonc`, 120 requests per minute per source address), refuses a burst beyond it with `429`. Both are answered before any workspace or secret lookup and logged without the payload. Intuit's retry behaviour for a non-2xx answer is not documented here, so treat a logged refusal as a delivery that may need the next scheduled sync to catch up.

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
- A void in QuickBooks is **recorded, not mirrored**. OpenInspection lists it under the items that need attention and leaves the invoice as it was, because voiding here resets the inspection's payment gate and can retract a published report — a decision, not something a poll should make for you. If the void was intended, void it here too.
- QuickBooks rejects a colon in a customer's name, so the name sent over is the contact's with any colons removed. The contact's record here is unchanged.

---

## Related

- [Deploy](../operate/deploy.md) — setting Worker secrets
- [Rotate the JWT keyring](../operate/rotate-jwt-keyring.md)
- [Invoicing and payments](https://inspectorhub.io/docs/invoicing-and-payments) — what syncs, from the user's side
