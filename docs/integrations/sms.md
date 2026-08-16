# SMS — Twilio and Telnyx

Appointment reminders, report-ready notices, and the opt-in confirmations the
consent flow depends on. Two providers; a company brings its own account, or a
SaaS deployment can supply a managed one.

**Sending SMS in the United States is a regulated activity, not a technical
one.** Carrier registration, the wording of your opt-in, and quiet hours are
covered in [`../self-host/sms-compliance.md`](../self-host/sms-compliance.md).
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

## Own, platform, managed

Three modes, resolved in `server/lib/sms/resolve-twilio.ts`, mirroring the email
path's own-vs-platform logic:

- **Own** takes effect only when the mode is set to own **and all three** of the
  tenant's keys are present. A half-finished switch does not half-apply.
- **Platform** uses the deployment's env credentials.
- **Managed** (SaaS only) uses the platform's ISV credential triple plus a
  Messaging Service SID, shared or dedicated to the tenant. All four fields must
  be truthy for this branch to fire, so a standalone deployment with no ISV
  credentials never builds a managed bag — fail-closed by construction rather
  than by a flag.

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
- `server/lib/sms/resolve-twilio.ts` — own / platform / managed resolution

## Related

- [SMS compliance](../self-host/sms-compliance.md) — **read this first**
- [Email](email.md) — the other channel, same own-vs-platform shape
- [Integration adapters](../develop/integration-adapters.md)
