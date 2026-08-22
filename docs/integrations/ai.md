# AI

Translation and drafting assistance inside the inspection editor. Optional, off
by default, and it never runs on a credential the tenant did not choose or the
deployment did not grant.

## What you need

| Key | Where | Required for |
|---|---|---|
| `AI_MODEL` | Worker env | **Everything.** No default is compiled in |
| `AI_BASE_URL` | Worker env | **Everything.** No default is compiled in |
| `GEMINI_API_KEY` | Settings → Advanced → AI (per company) | A company using its own key |
| `AI_MANAGED_API_KEY` | Worker env, managed deployments only | A deployment funding AI for entitled companies |

A company may override the endpoint and the model per workspace (Settings →
Advanced → AI); the worker env values are the deployment's defaults.

## One adapter, any OpenAI-compatible backend

Every AI call goes through a single adapter
(`server/lib/ai/providers/openai-compatible.ts`) that posts
`{base}/chat/completions` with an `Authorization: Bearer` header and reads
`choices[0].message.content` back. That is the shape the mainstream vendors
publish — including Google's own OpenAI-compatible endpoint — and it is also
what a local Ollama or vLLM speaks. There is no vendor-native adapter, and
adding a backend is a configuration change rather than a code change.

`AI_BASE_URL` is the root of that API. Point it wherever you like:

```
# A hosted provider's OpenAI-compatible endpoint
AI_BASE_URL=https://api.example.com/openai/v1
AI_MODEL=some-model-id

# A model running on your own network
AI_BASE_URL=http://10.0.0.20:11434/v1
AI_MODEL=llama3.1

# Through an AI gateway, where the vendor is named in the model string
AI_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
AI_MODEL=google-ai-studio/some-model-id
```

**An AI gateway is optional and entirely unused on a direct connection.** The
two `cf-aig-*` headers the adapter sets are emitted only when the configured
host really is that gateway; a request to your own provider carries neither.

When OpenInspection is self-hosted and configured to use an AI endpoint running
within your own network, inspection data sent to that AI endpoint does not need
to leave that network. Actual data flows depend on your configuration and any
third-party services you enable.

## `AI_MODEL` and `AI_BASE_URL` have no defaults, on purpose

With either unset, every AI feature fails closed with a 503. A compiled-in
default would pin whichever model or endpoint was current when the code was
written, and quietly keep using it years later — including after the vendor
retires it, at which point the failure arrives as a runtime error nobody
connected to a decision nobody made. A baked-in *destination* is worse still:
it would send inspection text somewhere no operator chose.

## Which credential a call uses

Resolved per call in `server/lib/ai/resolve-provider.ts`:

1. **The tenant's own stored key always wins.** A company that brought a key
   uses it, whatever the deployment provides.
2. Otherwise, in `saas` mode only, the deployment's managed key — and only for
   tenants the deployment grants managed access to. That grant is `isPaidPlan`
   (`server/features/plan-quota/policy.ts`), the single predicate every
   platform-funded capability reads.
3. In `standalone` there is no managed path at all. It is absent by
   construction, not disabled by a flag.

An entitled tenant on a deployment that never provisioned `AI_MANAGED_API_KEY`
gets the feature **off**, not a runtime credential error.

## Metering, and why it is split

Usage on the deployment's key meters under `ai_translate` / `ai_assist` and is
checked against the tier's allowance before the call. Usage on a tenant's own
key meters under `ai_translate_byo` / `ai_assist_byo` and never counts against a
deployment allowance — a company paying its own vendor bill should not also
spend a quota the deployment funds.

## What actually leaves the process

Enumerated field by field in
[`../compliance/ai-data-flow.md`](../compliance/ai-data-flow.md). If you are
answering a customer's question about what an AI feature sends, that document is
the answer; this page is not.

## When a call cannot run

Every refusal names itself. `server/lib/ai/refusal-reason.ts` holds a closed
vocabulary of seven reasons, and they travel in `details.reason` on the one
503 + `ai_not_configured` shape every AI refusal has always used — the status
and the code did not change, only the ability to say which situation applies:

| Reason | Who can act |
|---|---|
| `switched_off` | the company — they turned AI off; the key and endpoint are untouched |
| `not_configured` | the company — no key saved, or no model/endpoint configured |
| `unavailable_here` | nobody in Settings — this deployment offers no managed path, or the company is not granted one |
| `over_cap` | the company's allowance for the period is spent |
| `platform_key_missing` | **the operator** — an entitled company on a deployment whose managed key was never provisioned |
| `policy_not_accepted` | the company — the current privacy version has not been accepted |
| `upstream_credential` | the company — their own provider rejected the request |

`upstream_credential` covers 401, 402, 403 and 429, and all four get the same
sentence. A status code is not a diagnosis of somebody else's commercial
situation, so none of them produces payment language, and the raw status goes
to the log rather than to the person reading the screen.

## Test connection tests what you typed

Settings → Advanced → AI sends a one-token completion to the endpoint, model and
key **as submitted**, over the same URL a real call uses. It deliberately does
not probe a stored credential: after the destination became something a company
chooses, a probe of anything else would go green while every real call failed.
The result names which field to fix, and never contains the provider's own
response body.

## Where the code lives

- `server/lib/ai/resolve-provider.ts` — which credential, endpoint and model, per call
- `server/lib/ai/providers/openai-compatible.ts` — the one adapter
- `server/lib/ai/refusal-reason.ts` — the seven reasons a call cannot run
- `server/lib/ai/connection-test.ts` — the Test connection probe
- `server/lib/ai/capability-policy.ts` — what a tier may use
- `server/lib/ai/metering.ts` — the two meters above
- `server/lib/ai/output-classification.ts` — gated by `lint:ai-classification`

## Related

- [AI data flow](../compliance/ai-data-flow.md)
- [Integration adapters](../develop/integration-adapters.md)
