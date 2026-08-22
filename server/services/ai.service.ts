import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import { AppError, ErrorCode, Errors } from '../lib/errors';
import { AI_REFUSAL_REASON } from '../lib/ai/refusal-reason';
import { devRewrittenComment, devSuggestedComments } from '../lib/ai/dev-mock';
import type { AiProvider } from '../lib/ai/provider';
import { checkAiCapability, type AiCredentialPicture } from '../lib/ai/capability-policy';
import {
    AI_PROMPTS,
    type RewriteCommentPromptArgs,
    type SuggestCommentPromptArgs,
    type TranslateSegmentsPromptArgs,
    type VersionedPrompt,
} from '../lib/ai/prompts';
import { parseTranslatedSegments } from '../lib/ai/translate-response';
import { defectDigest, NO_DEFECTS_SUMMARY } from '../lib/ai/defect-digest';
import type { AiProvenanceSink } from '../lib/ai/provenance';
import type { AiQuotaPreflight } from '../lib/ai/metering';
import type { AiUsageKind } from '../lib/usage/period';

/**
 * The AI-powered features, over whichever backend was resolved for the request.
 *
 * IT NO LONGER KNOWS WHICH BACKEND THAT IS. The adapter arrives already built
 * from `lib/ai/resolve-provider.ts`, which is the single place that decides
 * credentials, endpoint and model. A workspace's own stored key always wins
 * there; where the deployment profile permits it (`hasManagedAi`) a
 * deployment-provided key may serve workspaces granted managed access instead.
 * This class re-derives none of that, and constructs no adapter of its own —
 * doing so would be a second answer to a question one module owns.
 *
 * HAVING credentials is not the same as the product OFFERING the capability
 * they would fund. `lib/ai/capability-policy.ts` holds that second answer and
 * `callGemini` asks it on every call, so a platform key appearing in the
 * environment cannot by itself release a capability nobody decided to ship.
 *
 * The PROMPTS live in `lib/ai/prompts.ts`, each under a stable version token,
 * so the largest input to a model's output is nameable rather than an inline
 * literal that can be reworded in passing. `callGemini` records provider /
 * mode / model / prompt version / timestamp to `ai_call_provenance` before
 * anything leaves the process; without that the version tokens were a naming
 * convention producing no evidence about any output ever generated.
 *
 * On a deployment that offers it (`aiDevMockFallback`), a missing key yields
 * the `[DEV]` placeholders in `lib/ai/dev-mock.ts` so the UI flow can be
 * exercised end to end. Everywhere else a missing key throws
 * `Errors.AINotConfigured` (503) so the client can route the inspector to AI
 * settings instead of showing a silent failure.
 *
 * The MODEL is configuration, never a source constant. There is deliberately
 * no baked-in default: a model id compiled into the binary is how a request
 * URL ends up pinned to one model with no way to change it, and a fallback
 * would hide the same mistake next time. Unconfigured fails closed.
 */
export class AIService {
    constructor(
        private db: D1Database,
        private apiKey: string,
        private appMode?: 'standalone' | 'saas',
        /** Model id from deployment configuration (`AI_MODEL`). Empty = not
         *  configured, which is an error rather than a cue to pick one. */
        private model: string = '',
        /** The ONE metering hook for AI, injected the same way the email
         *  pipeline injects its meter. Every AI feature funnels through
         *  `callGemini`, so one `record` there is the whole meter — a second
         *  counter at a route or a hook is how two numbers that have to agree
         *  stop agreeing. Undefined when there is no tenant to attribute to. */
        private meter?: { record(kind: AiUsageKind): Promise<void> },
        /** Whose credentials a call from this service would run on, and whether
         *  a confirmation is on file for them. `source` comes from
         *  `resolveRuntimeAiSource` — the SAME resolver that tags the meter, so
         *  the source the gate judges and the source the usage row records can
         *  never be two different answers. Never re-derived inside this class.
         *
         *  The default is FAIL-CLOSED on the confirmation: a construction that
         *  says nothing about it has not established one, and must not read as
         *  though it had. Callers that mean "the tenant's own, confirmed key"
         *  say so. */
        private credentials: AiCredentialPicture = { source: 'byo', tenantKeyAttested: false },
        /** Where the record of each call is written. Built in `di.ts` from the
         *  SAME credential picture as the meter and the gate above, so the mode
         *  a provenance row states and the mode the usage row is tagged with
         *  cannot be two different answers.
         *
         *  Optional in the TYPE, refused at RUNTIME: an object that says
         *  nothing about provenance has not established one, and a service
         *  constructed without a sink must not inherit a silent bypass. The
         *  same fail-closed reading as the confirmation above. */
        private provenance?: AiProvenanceSink,
        /** The read-only allowance check, paired with the meter above: CHECK
         *  BEFORE, METER AFTER. Undefined wherever there is nothing to enforce
         *  — a self-hosted deploy, a call on the tenant's own key, a tenant
         *  with no delivered allowance — which is why enforcement is absent in
         *  those cases rather than switched off by a flag here. */
        private quota?: AiQuotaPreflight,
        /** The adapter this request's call runs on, already built by
         *  `lib/ai/resolve-provider.ts` from the resolved credentials,
         *  endpoint and model.
         *
         *  Optional in the TYPE, refused at RUNTIME, for the same fail-closed
         *  reason as the provenance sink above: a construction that names no
         *  provider has had no credential decision made for it, and a service
         *  that answered by building one would be a second opinion about which
         *  backend an inspector's text is sent to. */
        private provider?: AiProvider,
    ) {}

    private isDevMode(): boolean {
        return this.appMode === 'standalone';
    }

    private hasApiKey(): boolean {
        return Boolean(this.apiKey) && !this.apiKey.includes('your_api_key');
    }

    /**
     * Fail closed on an unconfigured model.
     *
     * Deliberately NOT folded into the dev-mock branch: the mock exists for a
     * self-hoster who has no key yet, and widening it to cover a missing model
     * would write `[DEV] …` placeholder prose into a real report for someone
     * whose key works fine. A missing model is a configuration error at every
     * deployment mode, so it always throws.
     */
    private assertModelConfigured(): void {
        if (!this.model) {
            throw Errors.AINotConfigured(
                'AI is unavailable: no AI model is configured. Set AI_MODEL for this deployment.',
            );
        }
    }

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Run one completion through the resolved provider.
     *
     * The Gemini HTTP shape lives in `lib/ai/providers/gemini.ts` and nowhere
     * else. Keeping a second copy here would mean every future backend gets
     * written twice, which is the exact cost the abstraction exists to avoid.
     * Credential validation stays the adapter's, so the two entry points below
     * that do not pre-check are still covered. The empty-model case is asked
     * HERE as well as in the adapter — see below for why the earlier of the two
     * matters now.
     *
     * It takes a VERSIONED PROMPT plus its arguments, not a rendered string.
     * That is the difference between a prompt version that exists and one that
     * is recorded: while callers rendered the text themselves, the version
     * token was in scope at every call site and reached this method at none of
     * them. There is no overload accepting bare text, so no feature can send a
     * prompt this method cannot name.
     *
     * IT RETURNS THE PROVENANCE ROW ID ALONGSIDE THE TEXT, and that pairing is
     * the point. The ledger recorded every call from the day it shipped and no
     * caller could say WHICH row was theirs, so a review of this output had
     * nothing to cite: the call and its acceptance were two events with nothing
     * linking them. Handing the id back at the same moment as the text is what
     * makes `ai_content_reviews.ai_call_id` a fact rather than a guess, and it
     * is why `model` and `prompt_version` are not copied onto a review row —
     * they are reachable through this id.
     */
    private async callGemini<A>(
        prompt: VersionedPrompt<A>,
        args: A,
        kind: AiUsageKind = 'assist',
    ): Promise<{ text: string; aiCallId: string }> {
        // The capability gate, placed AFTER credential resolution (the source
        // was resolved upstream and handed to the constructor) and BEFORE any
        // content leaves the process. Every AI feature funnels through here, so
        // this one call covers all of them — the same reason the meter lives at
        // this method and nowhere else.
        //
        // Refusal is an explicit throw, never a silent skip or an empty string:
        // a capability the product does not offer must read as a refusal to the
        // caller, not as the model having nothing to say.
        //
        // It reuses AINotConfigured because "this call cannot run" already has
        // exactly one shape in this codebase — `resolveAi` returning null uses
        // it for the feature-off case, and every client already routes that to
        // "set up AI". A second 4xx/5xx shape here would mean two failure paths
        // for one situation.
        // Asked of the PROMPT, not of `kind`. `kind` is the cost split and
        // defaults to 'assist', so a new capability that forgot to pass one
        // would be judged as generic assistance; the prompt always carries its
        // own classification because the type requires it.
        const decision = checkAiCapability(prompt.classification, this.credentials);
        if (!decision.allowed) throw Errors.AINotConfigured(decision.message);

        // Hoisted from the adapter so a call that cannot possibly run does not
        // first write a provenance row claiming it was made. Same error, same
        // message — the adapter still checks, for callers that reach it another
        // way — asked one step earlier so the ledger only holds real sends.
        this.assertModelConfigured();

        // The allowance, BEFORE the send and before any row claims a call was
        // made. Read-only: the counter moves at `meter.record` below, so a
        // model failure never spends an allowance. Not swallowed, unlike the
        // meter — a spent allowance is an answer to the inspector, and a
        // caller that cannot tell "over your limit" from "nothing to say" is
        // the failure this whole pairing exists to prevent.
        if (this.quota) await this.quota.preflight(kind);

        // FAIL CLOSED on a missing sink. The alternative — record when a sink
        // happens to be present — is the failure this whole change is about: a
        // capability that produces output while leaving no evidence, with
        // nothing red to show for it. Reusing AINotConfigured keeps one
        // failure shape for "this call cannot run" (see the gate above), and it
        // is the one code `suggestComment` re-throws instead of degrading to an
        // empty list.
        const provenance = this.provenance;
        if (!provenance) {
            throw Errors.AINotConfigured(
                'AI is unavailable: this request cannot record AI call provenance.',
            );
        }

        // The adapter the resolver built. NOT one constructed here — see the
        // constructor note; this is the whole point of the seam.
        const provider = this.provider;
        if (!provider) {
            throw Errors.AINotConfigured(
                'AI is unavailable: no AI provider was resolved for this request.',
                AI_REFUSAL_REASON.NOT_CONFIGURED,
            );
        }
        // BEFORE the send, and awaited. The meter runs after success because a
        // failed call consumed no allowance; provenance is the opposite
        // question — the prompt leaves the process either way, so the record of
        // it has to exist first. A sink that cannot write therefore stops the
        // send rather than letting inspection content reach a third party
        // untracked.
        const aiCallId = await provenance.record({
            capability: kind,
            promptVersion: prompt.version,
            provider: provider.id,
        });
        const { text } = await provider.complete({ prompt: prompt.render(args) });
        // Meter AFTER success, never before — a model call that failed must not
        // consume an allowance it did not spend. The swallowed rejection
        // matches the send sites: a metering failure must never fail the
        // inspector's operation.
        if (this.meter) await this.meter.record(kind).catch(() => {});
        return { text, aiCallId };
    }

    /**
     * WHAT `aiCallId` IS NULL FOR, ON EVERY METHOD BELOW THAT CAN RETURN NULL.
     *
     * The invariant is one sentence: `aiCallId` is present exactly when the
     * payload carries model-generated text. Three arms return prose that no
     * model wrote — the standalone dev mocks, the "no defects observed" literal
     * on the summary path, and the empty suggestion list a runtime failure
     * degrades to — and a provenance id attached to any of them would be
     * evidence of a call that either never happened or produced nothing. A
     * review row cites this id, so an id here that names the wrong thing is
     * worse than no id: it would document a human reviewing model output where
     * there was none. Callers read the null as "there is nothing to review".
     */

    /**
     * Rewrites a rough note into a professional report comment.
     *
     * The one path with no non-AI arm, so `aiCallId` is always a real row.
     */
    async generateProfessionalComment(text: string, context?: string) {
        return this.callGemini(AI_PROMPTS.professionalComment, { text, context });
    }

    /**
     * Renders report segments into another language, as a courtesy copy. THE THIRD ARGUMENT IS NOT OPTIONAL: `kind` defaults to
     * 'assist', and a translation counted there makes both metrics wrong at once — with no type error. The capability gate reads the
     * PROMPT's classification inside `callGemini`; response shape and segment-count invariance live in `lib/ai/translate-response.ts`.
     */
    async translateSegments(input: TranslateSegmentsPromptArgs): Promise<{ segments: string[]; aiCallId: string }> {
        const { text, aiCallId } = await this.callGemini(AI_PROMPTS.translate, input, 'translate');
        return { segments: parseTranslatedSegments(text, input.segments.length), aiCallId };
    }

    /**
     * Generates a high-level summary of defects found in an inspection.
     */
    async generateInspectionSummary(
        tenantId: string,
        inspectionId: string,
    ): Promise<{ summary: string; aiCallId: string | null }> {
        const db = this.getDrizzle();

        // 1. Verify ownership and existence
        const inspection = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        if (!inspection || inspection.tenantId !== tenantId) {
            throw new Error('Inspection not found or access denied');
        }

        // 2. Fetch results (scoped by tenantId for defense-in-depth)
        const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId))).get();
        if (!results) return { summary: NO_DEFECTS_SUMMARY, aiCallId: null };

        // WHICH FIELDS LEAVE THE PROCESS is decided in `lib/ai/defect-digest.ts`,
        // not inline here — see that module for why the boundary is named.
        const defects = defectDigest(results.data as Record<string, { status: string; notes?: string }>);

        if (!defects) return { summary: NO_DEFECTS_SUMMARY, aiCallId: null };

        const { text, aiCallId } = await this.callGemini(AI_PROMPTS.inspectionSummary, { defects });
        return { summary: text, aiCallId };
    }

    /**
     * Spec 5B P2B — rewrites a single canned/custom comment based on
     * inspector instructions, given the surrounding inspection context.
     *
     * Behavior mirrors `suggestComment`:
     *  - Throws 503 ServiceUnavailable when GEMINI_API_KEY is not configured.
     *  - Returns the rewritten string verbatim (trimmed). On Gemini parse
     *    failure, throws so the UI can show an error toast (no silent
     *    overwrite of the inspector's existing text).
     */
    async rewriteComment(
        input: RewriteCommentPromptArgs,
    ): Promise<{ rewritten: string; aiCallId: string | null }> {
        if (!this.hasApiKey()) {
            // Dev-mock instead of throwing on a deployment that offers it.
            if (this.isDevMode()) {
                return { rewritten: devRewrittenComment(input.originalComment, input.instruction), aiCallId: null };
            }
            throw Errors.AINotConfigured(
                'AI is not configured. Set an API key in Settings → Advanced → AI.',
                AI_REFUSAL_REASON.NOT_CONFIGURED,
            );
        }
        this.assertModelConfigured();

        const { text, aiCallId } = await this.callGemini(AI_PROMPTS.rewriteComment, input);
        // Strip wrapping quotes / markdown the model sometimes adds.
        return { rewritten: text.replace(/^["'`]+|["'`]+$/g, '').trim(), aiCallId };
    }

    /**
     * Suggests 3 professional inspection comments for a specific form item.
     * Throws 503 ServiceUnavailable when GEMINI_API_KEY is not configured so the
     * UI can surface a clear "set up your API key" message instead of a silent
     * empty popover. Runtime Gemini failures still degrade to an empty array.
     */
    async suggestComment(
        params: SuggestCommentPromptArgs,
    ): Promise<{ suggestions: string[]; aiCallId: string | null }> {
        if (!this.hasApiKey()) {
            // Dev-mode mock so local development can exercise the full Suggest
            // flow without spending anyone's provider allowance.
            if (this.isDevMode()) {
                return { suggestions: devSuggestedComments(params.itemName), aiCallId: null };
            }
            throw Errors.AINotConfigured(
                'AI is not configured. Set an API key in Settings → Advanced → AI.',
                AI_REFUSAL_REASON.NOT_CONFIGURED,
            );
        }
        // Outside the try/catch below on purpose: that catch turns RUNTIME
        // failures into an empty suggestion list, and a configuration error
        // must not disappear into "no suggestions today".
        this.assertModelConfigured();

        try {
            const { text, aiCallId } = await this.callGemini(AI_PROMPTS.suggestComment, params);
            const match = text.match(/\[[\s\S]*\]/);
            // An unparseable completion yields nothing to review, so it yields
            // no id either — see the invariant above. The provenance row for the
            // call still exists; what does not exist is any text a person could
            // have reviewed, and this method's contract is about the latter.
            if (!match) return { suggestions: [], aiCallId: null };
            return { suggestions: JSON.parse(match[0]) as string[], aiCallId };
        } catch (err) {
            // Same rule as `assertModelConfigured` above, applied to the two
            // refusals that can only be raised from INSIDE this try: the
            // capability gate and the allowance pre-flight in `callGemini`. A
            // runtime model failure degrades to "no suggestions"; a capability
            // the product does not offer, or an allowance already spent, must
            // reach the inspector as a refusal — not as an empty popover that
            // looks like the model had nothing to say. Matched on CODE, so a
            // third refusal added at the chokepoint has to be listed here
            // rather than silently inheriting the degrade.
            // The adapter now raises AI_NOT_CONFIGURED for 401/402/403/429 as
            // well, which lands here already listed. That is deliberate: a
            // provider refusing the credentials, or the account behind them, is
            // not "the model had nothing to say" — and on a workspace's own key
            // the person who can fix it is the workspace, who sees nothing at
            // all if this degrades.
            if (err instanceof AppError
                && (err.code === ErrorCode.AI_NOT_CONFIGURED || err.code === ErrorCode.QUOTA_EXHAUSTED)) throw err;
            return { suggestions: [], aiCallId: null };
        }
    }
}
