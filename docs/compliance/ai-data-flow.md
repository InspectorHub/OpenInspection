# What leaves this process when an AI feature runs

Every AI feature in OpenInspection funnels through one method, sends text to one
third-party endpoint, and sends nothing else anywhere. This page states exactly
what that text contains, field by field, read from the code rather than from a
design document.

It exists because "we send inspection content to a model" is not a statement
anyone can act on. A data protection assessment, a subprocessor disclosure and a
tenant's own question ("does my client's address go to Google?") all need the
field list, and the field list is only true if it was read off the prompt
renderers — which is what was done here.

**Verified 2026-08-11.** Every claim carries an evidence level:

| level | means |
|---|---|
| **E2** | read in the source of this repository, at the file named beside it |
| **E3** | checked against a running production deployment |
| **E4** | observed end to end in production, not inferred from a test |

Nothing on this page is above E2. No claim here was checked against production;
where a fact can only be established that way, it says so instead of guessing.

---

## 1. The chokepoint

`AIService.callGemini` (`server/services/ai.service.ts`) is the only method in
the codebase that sends text to a model. **E2.** It takes a versioned prompt
object and its arguments — never a pre-rendered string — so no feature can send
text that cannot be traced to a named prompt.

Before anything leaves, in this order (**E2**):

1. **The capability gate** (`server/lib/ai/capability-policy.ts` reading the
   posture table in `server/lib/ai/output-classification.ts`) decides whether
   this product generates this kind of output on these credentials at all.
2. **The model check** — an unconfigured `AI_MODEL` fails closed; there is no
   compiled-in default.
3. **The allowance pre-flight** — read-only, and only for platform-funded calls.
4. **The provenance write** — a row in `ai_call_provenance` recording provider,
   credential source, model and prompt version. It is awaited, so a sink that
   cannot write stops the send rather than letting content leave untracked.

Only then does the adapter run. The usage counter moves *after* a successful
response, never before.

## 2. The endpoint

`server/lib/ai/providers/gemini.ts` is the only file that knows the wire shape.
**E2.**

```
POST https://generativelanguage.googleapis.com/v1/models/{AI_MODEL}:generateContent?key={apiKey}
Content-Type: application/json
```

That is the **Gemini Developer API** with a bare API key — *not* Vertex AI, and
not a Google Cloud service account. The request body is exactly:

- `contents[0].parts[0].text` — the rendered prompt (section 3).
- `generationConfig` — `temperature`, `topP`, `topK`, `maxOutputTokens`.

**No other field is sent.** There is no tenant identifier, no user identifier,
no inspection identifier, no request id and no custom header. The API key
travels in the query string, which is Google's documented shape for this API and
is the reason the key must never be logged with the URL.

### Which key it is

Credentials are resolved per call by `server/lib/ai/resolve-provider.ts`
(**E2**):

- A workspace's **own** stored key always wins, in every deployment mode.
- A **deployment-provided** key (`AI_MANAGED_API_KEY`) may serve a workspace
  where `profile.hasManagedAi` is true and the deployment grants that workspace
  managed access. A deployment that never provisioned such a key resolves the
  feature OFF rather than raising a credential error mid-report.
- A self-hosted deployment has no managed path at all — the workspace's own key
  or nothing.

The two paths are metered apart (`ai_*` versus `ai_*_byo`) so the volume a
deployment funds is never confused with the volume a workspace funds.

## 3. What is in the text, prompt by prompt

Four prompts exist (`server/lib/ai/prompts.ts`). **E2 for every row.** "Free
text" means an inspector typed it and it may therefore contain anything the
inspector chose to type, including names and addresses. Everything else is
structured data drawn from a template or a numeric property fact.

### `professional-comment.v1` — `POST /api/ai/comment-assist`

| field | source | free text? |
|---|---|---|
| `text` | the inspector's rough note | **yes** |
| `context` | optional caller-supplied context string; renders as `General inspection` when absent | **yes** |

### `inspection-summary.v1` — `POST /api/ai/auto-summary`

| field | source | free text? |
|---|---|---|
| `defects` | the `notes` of every result whose status is `Defect`, joined one per line; a defect with no note contributes the literal `No description provided` | **yes** |

The route is called with an `inspectionId`, and **the id does not leave the
process** — it selects rows. Neither the property address nor any contact name
is read into this prompt. What reaches the model is the defect notes and nothing
else.

### `rewrite-comment.v1` — `POST /api/ai/comment/edit`

| field | source | free text? |
|---|---|---|
| `itemLabel` | template item label | no |
| `sectionTitle` | template section title | no |
| `tab` | one of `information` / `limitations` / `defects` | no |
| `category` | optional; one of `safety` / `recommendation` / `maintenance`; rendered only on the `defects` tab | no |
| `location` | optional; rendered only on the `defects` tab | **yes** |
| `originalComment` | the comment being revised | **yes** |
| `instruction` | what the inspector asked for | **yes** |

`location` is a place *within* the building ("north-west corner"), but it is an
open string: an inspector may type anything into it. It is listed as free text
for that reason, not because the feature intends it to carry identifiers.

### `suggest-comment.v1` — `POST /api/ai/suggest-comment`

| field | source | free text? |
|---|---|---|
| `itemName` | template item name | no |
| `sectionName` | template section name | no |
| `rating` | optional rating value | no |
| `yearBuilt` | optional integer | no |
| `sqft` | optional integer | no |

**This prompt sends no free text at all**, and the closed field list is
deliberate. The request schema used to accept a `propertyAddress` that the
prompt never rendered — the address was validated and then dropped, which was
the right outcome resting entirely on a comment. The field was deleted rather
than guarded, and `tests/unit/ai/prompt-address-boundary.spec.ts` fails if an
identifier of the property or the client is added back. **E2.**

### Photographs

No AI feature in this repository sends an image. Every prompt above renders to a
single text part; the adapter has no multimodal path. **E2.**

## 4. What is recorded on this side

`ai_call_provenance` holds one row per call: tenant, credential source, model,
provider id, prompt version, timestamp. **The prompt text is not stored** — not
truncated, not hashed, not the first line. The entry type has no field that
could carry it, which is the enforcement rather than a policy. **E2.**

`usage_counters` holds a count per workspace, per metric, per calendar month.
Counts only, no content. **E2.**

## 5. The terms the endpoint is subject to

Google publishes two different sets of terms for the same Gemini API endpoint,
and which one applies is a property of the **billing project the API key belongs
to** — not of the request, the model id, or anything in this repository.

- **Unpaid / free tier.** Google states that prompts and responses may be used
  to improve Google products, and that human reviewers may read them. Content
  submitted on an unpaid key must therefore be treated as disclosed to Google
  for its own purposes.
- **Paid tier.** Google states that prompts and responses are not used to
  improve Google products, and that abuse-monitoring logs are retained for a
  limited period (Google documents 55 days at the time of writing). Google's
  processor terms apply, and they are accepted **by use** rather than by
  signature.

Authoritative sources, which override this page if they diverge:

- Gemini API Additional Terms of Service — <https://ai.google.dev/gemini-api/terms>
- Gemini API pricing and tiers — <https://ai.google.dev/gemini-api/docs/pricing>
- Google Cloud Platform Terms / Data Processing Addendum — <https://cloud.google.com/terms/data-processing-addendum>

**These are Google's statements, cited, not verified by this repository.** They
are the reason section 6 exists.

## 6. The region rule, and the thing the software cannot check

**Only a paid-tier key may serve users in the EEA, Switzerland or the United
Kingdom.**

The tier is a property of the key's billing project. **The software cannot
detect it.** There is no field in the request, no field in the response, and no
API this repository calls that reports which tier a key is on. `AI_MODEL` does
not imply it and neither does the model's behaviour.

Three consequences, stated plainly because each one has been assumed away
before:

1. **A deployment-provided key must be confirmed as paid-tier by a person**,
   once, before it is provisioned, and that confirmation recorded as evidence.
   No code path can re-check it later.
2. **A workspace's own key is the workspace's own responsibility.** The
   deployment cannot see that key's tier either. This is why the
   bring-your-own-key path asks a workspace to confirm what its own provider
   account permits before the key may be used.
3. **A key silently downgraded** — billing removed from the project — keeps
   working and starts falling under the unpaid terms, with nothing in this
   system able to notice. Monitoring that is a billing-account task, not an
   application one.

## 7. Open items

- **Sections 5 and 6 are E2-by-citation only.** Nobody has re-read Google's
  pages as part of this write-up; the statements come from the counsel review
  that commissioned it. Re-checking them, with the date, is worth doing before
  any disclosure quotes this page.
- **No production observation.** Whether any AI call has ever been made on this
  deployment, and on which credential source, is an E3/E4 question about
  `ai_call_provenance` and `usage_counters` that this document does not answer.
