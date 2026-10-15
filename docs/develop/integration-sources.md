# Integration sources

For each outside service a company can run on one of two **sources**:

| Source | Shown as | Meaning |
|---|---|---|
| `provided` | Built-in | The deployment supplies the service (its own account, key or app). |
| `own` | Your own | The company's own account or keys, saved in its settings. |

Which sources exist depends on the deployment profile. A **standalone** (self-hosted) deployment only ever offers `own`; the operator's environment variables count as that company's own credentials, as they always have. A deployment that supplies services offers `provided` as well, where the service allows it.

This is separate from a service's **state**, which says whether it works: *Connected*, *Needs attention* or *Not connected*. Source answers "whose account"; state answers "is it working".

## Services

| Service | `provided` offered when | `own` means | Notes |
|---|---|---|---|
| `email` | the profile has `providesEmailSource` | the company's own email provider keys and sender address | An `own` choice with incomplete keys sends nothing; it never falls back to the deployment's account. |
| `sms` | never, until `SMS_MANAGED_SHARED_ENABLED` is `true` or `1` | the company's own Twilio or Telnyx keys | The flag is off by default. While it is off the shared number is not offered and resolves to `unavailable` with reason `provider_confirmation_pending`. |
| `ai` | the deployment has a managed AI path | the company's own AI provider key | |
| `video` | the deployment chooses the video backend | the operator's Stream binding and customer subdomain (self-hosted) | A hosted deployment has no `own` video. |
| `quickbooks` | the deployment supplies the QuickBooks app | the company's own Intuit app (client id and secret) | |

Stripe is not in this list. A company always collects payments into its own Stripe account.

## Choosing a source

A company's explicit choice is stored inside the existing `tenant_configs.integration_config` JSON, under `integrationSources`:

```json
{ "integrationSources": { "email": "own", "ai": "provided" } }
```

There is no migration. Keys stay in the encrypted secrets store, so switching a service to `provided` and back loses nothing the company entered.

`server/lib/integrations/stored-sources.ts` reads the choice leniently (an unknown service or value is ignored, never an error), validates a requested change strictly, and merges a change into the current JSON. A requested change must be merged into the current row on the server; a copy held by a client would overwrite concurrent edits.

### Companies that never chose

A company with no stored choice keeps exactly the behaviour it had before this model existed. The default is derived from what the code already does:

- email, SMS: the existing `email_mode` / `sms_mode` column (`own` means `own`; anything else means `provided`);
- AI: a stored company key means `own`, otherwise `provided`;
- QuickBooks: the deployment's app when it has one, else the company's own app when complete (the long-standing merge rule);
- video: `provided` on a deployment that chooses the backend, `own` otherwise.

Only a stored choice is *strict*:

1. `own` never falls back to the deployment's credentials. Incomplete own credentials resolve to `unavailable` with reason `own_credentials_incomplete`.
2. `provided` never reads the company's stored credentials. A deployment that lacks the credential resolves to `unavailable` with reason `provided_not_configured`.
3. A source the profile does not offer resolves to `unavailable` with reason `not_offered`.

The retired SMS value `platform` is not a valid choice anywhere: it is dropped when read and refused when written. The legacy column still holds it by default, and there it only means "no choice was made".

## Resolver

`server/lib/integrations/sources.ts`:

```ts
resolveIntegrationSource(service, profile, companyConfig, env)
  // => { service, source: 'provided' | 'own' | 'unavailable',
  //      reason, credentialsPresent, choice: 'explicit' | 'default' }
```

It is pure: no I/O, no clock, no network. `env` must be the deployment's environment. A request-scoped env that already had a company's secrets merged into it overstates what the deployment provides.

The per-service resolvers keep their credential and endpoint logic and ask this one only which source applies:

| Service | Consulted from |
|---|---|
| email | `server/lib/integrations/email-source.ts`, called by `assembleTenantEmailService` |
| sms | `loadProviderForTenant` in `server/lib/sms/resolve-twilio.ts` |
| ai | `resolveAi` (`sourceChoice`), set by `buildTenantAiService` |
| video | the profile capability `videoBackendManaged` is the decision; a test asserts it agrees with the resolver |
| quickbooks | `resolveQboCredentialsForTenant`, used by the inbound sweep |

## Overview

`integrationSources(profile, companyConfig, env)` in `server/lib/integrations/source-overview.ts` returns, for each service, the sources available, the current one and a state, derived with no network call. A source that is `unavailable` reads as *Needs attention* when the person can finish it (half-entered keys) or the deployment lacks a credential it should provide, and as *Not connected* otherwise.

`GET /api/integrations/overview` (owner or manager) serves the Integrations page. It returns one card per service, in page order: card payments, accounting, calendar, email, SMS, address suggestions, property facts, video and AI. Each card carries `status` (is it working), `source` (whose account), `canUseOwn` (the company may switch between Built-in and Your own), the settings page that manages it, and the message key that explains an unavailable source. Services the resolver covers take their source and state from it; the others are read from the same facts (keys the deployment holds, keys the company stored). A card never carries a key, only whether one is set. QuickBooks and Google Calendar also need a real sign-in before they read as connected. The builder is `server/lib/integrations/overview.ts` and is pure; `overview-data.ts` reads one company's rows.

## The held-back shared SMS number

The monthly allowance for sends on a deployment-provided number is `MANAGED_SMS_MONTHLY_ALLOWANCE` (an integer; default 1000 when absent or not a positive number). Manual sends and the automation cron both read it.

While `SMS_MANAGED_SHARED_ENABLED` is off, a deployment that supplies a shared number does not send on it. The SMS send gate (`managedSendAllowed`, run by `smsSendGate` for every send path: manual send, automations, template test-send, settings test-connection) refuses any company whose stored mode is not `own` with the reason `provider_confirmation_pending`. The automation log row records it as `skipped` with that error, and the manual-send API returns it as the skip reason. A company on its own account, and every self-hosted deployment, is unaffected. Callers must hand the gate the deployment env (or a resolved `profile`); an omitted env reads as self-hosted.

## Messages for reasons

`sourceReasonMessageKey({ service, source, reason })` in `server/lib/integrations/source-reasons.ts` returns the message key (prefix `integrations_source_reason_`, in `messages/en` and `messages/es-419`) that explains why a source is unavailable, or null when nothing needs saying. User interfaces render that key rather than writing their own text.
