# AI

Translation and drafting assistance inside the inspection editor. Optional, off
by default, and it never runs on a credential the tenant did not choose or the
deployment did not grant.

## What you need

| Key | Where | Required for |
|---|---|---|
| `AI_MODEL` | Worker env | **Everything.** No default is compiled in |
| `GEMINI_API_KEY` | Settings → Advanced → AI (per tenant) | A company using its own key |
| `AI_MANAGED_API_KEY` | Worker env, SaaS only | A deployment funding AI for entitled tenants |

## `AI_MODEL` has no default, on purpose

With it unset, every AI feature fails closed with a 503. A compiled-in default
would pin whichever model was current when the code was written, and quietly
keep using it years later — including after the vendor retires it, at which
point the failure arrives as a runtime error nobody connected to a decision
nobody made.

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

## When it is not configured

AI features are hidden rather than shown-and-broken. Settings → Advanced → AI
has a Test connection diagnostic which reads `GEMINI_API_KEY` and reports
plainly whether a key is present and whether the vendor accepted it.

## Where the code lives

- `server/lib/ai/resolve-provider.ts` — which credential, per call
- `server/lib/ai/capability-policy.ts` — what a tier may use
- `server/lib/ai/metering.ts` — the two meters above
- `server/lib/ai/output-classification.ts` — gated by `lint:ai-classification`

## Related

- [AI data flow](../compliance/ai-data-flow.md)
- [Integration adapters](../develop/integration-adapters.md)
