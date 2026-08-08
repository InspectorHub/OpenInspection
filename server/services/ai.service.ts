import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import { AppError, ErrorCode, Errors } from '../lib/errors';
import { GeminiProvider } from '../lib/ai/providers/gemini';
import { checkAiCapability, type AiCredentialPicture } from '../lib/ai/capability-policy';
import {
    AI_PROMPTS,
    type RewriteCommentPromptArgs,
    type SuggestCommentPromptArgs,
    type VersionedPrompt,
} from '../lib/ai/prompts';
import type { AiProvenanceSink } from '../lib/ai/provenance';
import type { AiUsageKind } from '../lib/usage/period';

/**
 * Service to handle AI-powered features using Google Gemini.
 *
 * CREDENTIALS COME FROM ONE OF TWO SOURCES, not one. A tenant's own stored key
 * (Settings → Advanced → AI) always wins and is unchanged by anything below.
 * Where the deployment profile permits it (`hasManagedAi` — saas only), a
 * deployment-provided key may serve tenants granted managed access instead;
 * that grant is a boolean this service is handed, never a decision it makes.
 * In standalone the managed path does not exist at all, so it remains the
 * tenant's key or nothing, exactly as before. Selection lives in
 * `lib/ai/resolve-provider.ts` — this class does not re-derive it.
 *
 * This paragraph replaces a "strictly bring-your-own-key" statement that the
 * managed path contradicts; without the correction the next reader treats that
 * path as a regression and deletes it.
 *
 * HAVING credentials is not the same as the product OFFERING the capability
 * they would fund. `lib/ai/capability-policy.ts` holds that second answer and
 * `callGemini` asks it on every call. Until it existed, the managed path was
 * merely starved — no deployment had provisioned a platform key — and one
 * `wrangler secret put` by whoever provisions infrastructure would have turned
 * it on without anyone deciding to ship it. The gate changes nothing today and
 * that is the point: an accident becomes a stated refusal that survives the
 * key being configured.
 *
 * The PROMPTS live in `lib/ai/prompts.ts`, each under a stable version token,
 * so the largest input to a model's output is nameable rather than an inline
 * literal that can be reworded in passing. Those tokens are now WRITTEN DOWN:
 * `callGemini` records provider / mode / model / prompt version / timestamp to
 * `ai_call_provenance` before anything leaves the process. Until it did, the
 * versioning was a naming convention that produced no evidence for any output
 * this product has ever generated.
 *
 * Sprint 1 A-4: when running in `standalone` mode without a Gemini API key,
 * `suggestComment` returns dev-mock suggestions so local development can
 * exercise the UI flow end-to-end. Production deploys (`saas` mode or
 * unspecified) throw `Errors.AINotConfigured` (503) so the client can
 * route the inspector to AI settings instead of showing a silent failure.
 *
 * The MODEL is configuration, never a source constant. There is deliberately
 * no baked-in default: a model id compiled into the binary is how the request
 * URL ended up pinned to one model for two years with no way to change it, and
 * a fallback would hide the same mistake next time. Unconfigured fails closed.
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
     */
    private async callGemini<A>(
        prompt: VersionedPrompt<A>,
        args: A,
        kind: AiUsageKind = 'assist',
    ) {
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

        const provider = new GeminiProvider({ apiKey: this.apiKey, model: this.model });
        // BEFORE the send, and awaited. The meter runs after success because a
        // failed call consumed no allowance; provenance is the opposite
        // question — the prompt leaves the process either way, so the record of
        // it has to exist first. A sink that cannot write therefore stops the
        // send rather than letting inspection content reach a third party
        // untracked.
        await provenance.record({
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
        return text;
    }

    /**
     * Rewrites a rough note into a professional report comment.
     */
    async generateProfessionalComment(text: string, context?: string) {
        return this.callGemini(AI_PROMPTS.professionalComment, { text, context });
    }

    /**
     * Generates a high-level summary of defects found in an inspection.
     */
    async generateInspectionSummary(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();

        // 1. Verify ownership and existence
        const inspection = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        if (!inspection || inspection.tenantId !== tenantId) {
            throw new Error('Inspection not found or access denied');
        }

        // 2. Fetch results (scoped by tenantId for defense-in-depth)
        const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId))).get();
        if (!results) return 'No significant defects observed during this inspection.';

        const data = results.data as Record<string, { status: string; notes?: string }>;
        const defects = Object.entries(data)
            .filter(([_, val]) => val.status === 'Defect')
            .map(([_, val]) => `- ${val.notes || 'No description provided'}`)
            .join('\n');

        if (!defects) return 'No significant defects observed during this inspection.';

        return this.callGemini(AI_PROMPTS.inspectionSummary, { defects });
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
    async rewriteComment(input: RewriteCommentPromptArgs): Promise<string> {
        if (!this.hasApiKey()) {
            // Sprint 1 A-4: dev-mock instead of throwing in standalone mode.
            if (this.isDevMode()) {
                return `[DEV] ${input.originalComment} (rewritten: ${input.instruction})`.trim();
            }
            throw Errors.AINotConfigured(
                'AI is not configured. Set GEMINI_API_KEY in Settings → Advanced → AI.'
            );
        }
        this.assertModelConfigured();

        const text = await this.callGemini(AI_PROMPTS.rewriteComment, input);
        // Strip wrapping quotes / markdown the model sometimes adds.
        return text.replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    /**
     * Suggests 3 professional inspection comments for a specific form item.
     * Throws 503 ServiceUnavailable when GEMINI_API_KEY is not configured so the
     * UI can surface a clear "set up your API key" message instead of a silent
     * empty popover. Runtime Gemini failures still degrade to an empty array.
     */
    async suggestComment(params: SuggestCommentPromptArgs): Promise<string[]> {
        if (!this.hasApiKey()) {
            // Sprint 1 A-4: dev-mode mock so local development can exercise
            // the full Suggest flow without burning Gemini quota.
            if (this.isDevMode()) {
                const item = params.itemName || 'Item';
                return [
                    `[DEV] ${item} appears serviceable with no defects observed at the time of inspection.`,
                    `[DEV] ${item} requires routine maintenance attention; recommend periodic inspection.`,
                    `[DEV] ${item} shows signs of wear; monitor over the next inspection cycle.`,
                ];
            }
            throw Errors.AINotConfigured(
                'AI is not configured. Set GEMINI_API_KEY in Settings → Advanced → AI.'
            );
        }
        // Outside the try/catch below on purpose: that catch turns RUNTIME
        // failures into an empty suggestion list, and a configuration error
        // must not disappear into "no suggestions today".
        this.assertModelConfigured();

        try {
            const text = await this.callGemini(AI_PROMPTS.suggestComment, params);
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) return [];
            return JSON.parse(match[0]) as string[];
        } catch (err) {
            // Same rule as `assertModelConfigured` above, applied to the one
            // refusal that can only be raised from INSIDE this try: the
            // capability gate in `callGemini`. A runtime model failure degrades
            // to "no suggestions"; a capability the product does not offer must
            // reach the inspector as a refusal, not as an empty popover that
            // looks like the model had nothing to say.
            if (err instanceof AppError && err.code === ErrorCode.AI_NOT_CONFIGURED) throw err;
            return [];
        }
    }
}
