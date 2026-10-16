# SMS — Twilio and Telnyx

Appointment reminders, report-ready notices, and the opt-in confirmations the
consent flow depends on. Two providers, Twilio and Telnyx. A company sends from
its own account with either one; where a deployment files carrier registrations,
a company can instead have a dedicated number registered for it. There is no
shared sender.

**Sending SMS in the United States is a regulated activity, not a technical
one.** Carrier registration, the wording of your opt-in, and quiet hours are
covered in [`../operate/sms-compliance.md`](../operate/sms-compliance.md).
That page is not optional reading, and the credentials below will not get a
message delivered without it.

## What you need

Settings → Communication → SMS.

| Provider | Keys |
|---|---|
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Telnyx | `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_PUBLIC_KEY` |

`TELNYX_PUBLIC_KEY` is a base64 Ed25519 **public** key and verifies inbound
webhooks. It has no format gate, because Ed25519 keys carry no stable prefix to
check against — which is also why the field will accept a wrong paste without
complaint, so confirm it against the Telnyx portal rather than the field's
silence.

## Your own account, or a dedicated number

SMS has one source in Settings: **Your own**, the company's own Twilio or Telnyx
account (see [Integration sources](../develop/integration-sources.md)). It is
resolved in `server/lib/sms/resolve-twilio.ts`:

- **Own** takes effect only when **all** of the company's keys for the chosen
  provider are present. A half-finished switch does not half-apply. On a
  self-hosted deployment the operator's environment credentials count as the
  company's own.
- **Dedicated number** (`managed_dedicated`, only where the deployment files
  carrier registrations) sends from a number registered for the company, through
  a Messaging Service. All of the deployment's registration credentials must be
  present for this branch to fire, so a deployment without them never builds it
  and fails closed. Sends wait for recorded carrier approval.
- A stored shared-sender mode (`managed_shared`), and the legacy `platform` mode
  on a hosted deployment, are not configured: nothing is sent on them. The
  `SMS_MANAGED_SHARED_ENABLED` switch that once gated this is retired and has no
  effect.

## Every message goes through one gate chain

`server/lib/sms/send-gate.ts`. This is worth knowing before you add a send path.

There used to be three copies of the chain — the real send, the template test
send, and the settings test-connection send. None of them BYPASSED the gates;
each carried its own copy. When the STOP-revocation check was added it landed in
one of the three, and the other two simply were not there to receive it. So the
chain lives in one place and a caller declares its `purpose` instead of
reimplementing the checks.

If you are adding a way to send an SMS, route it through that gate. Do not
assemble a provider call directly.

## When it is not configured

No SMS is sent. Notifications that have an email path fall back to email; ones
that do not are simply not offered — the recipient is not shown a channel the
deployment cannot use.

## When it breaks

- Delivery status arrives on the provider webhook and is recorded per message
  (`server/lib/sms/delivery-status.ts`), so a failed send is visible per
  recipient rather than as a global counter.
- Settings → Communication has a test send. It runs the same gate chain as a
  real send, which is the point: a test that skipped the gates would tell you
  the credentials work and nothing about whether a message would actually go.

## Where the code lives

- `server/lib/sms/` — the gate chain, consent, phone normalisation, segments
- `server/lib/messaging/twilio.ts`, `server/lib/messaging/provider.ts`
- `server/lib/sms/resolve-twilio.ts` — own / dedicated-number resolution

## Related

- [SMS compliance](../operate/sms-compliance.md) — **read this first**
- [Email](email.md) — the other channel; it also has a Built-in option where the deployment supplies one
- [Integration adapters](../develop/integration-adapters.md)
