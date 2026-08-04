import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { GeminiProvider } from '../lib/ai/providers/gemini';
import type { AiUsageKind } from '../lib/usage/period';

/**
 * Service to handle AI-powered features using Google Gemini.
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
     * Credential and model validation (including the fail-closed empty-model
     * case) is the adapter's, so the two entry points below that do not
     * pre-check are still covered.
     */
    private async callGemini(prompt: string, kind: AiUsageKind = 'assist') {
        const provider = new GeminiProvider({ apiKey: this.apiKey, model: this.model });
        const { text } = await provider.complete({ prompt });
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
        const prompt = `You are a professional home inspector. Rewrite the following rough observation into a professional, clear, and objective report comment. 
Keep it concise but informative. 
Context: ${context || 'General inspection'}
Rough Note: "${text}"
Professional Comment:`;

        return this.callGemini(prompt);
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

        const prompt = `You are a professional home inspector. Analyze the following list of defects found during an inspection and provide a high-level summary (2-3 sentences) focusing on the most critical issues for the home buyer.
Defects:
${defects}
Summary:`;

        return this.callGemini(prompt);
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
    async rewriteComment(input: {
        itemLabel:       string;
        sectionTitle:    string;
        tab:             'information' | 'limitations' | 'defects';
        originalComment: string;
        instruction:     string;
        category?:       'safety' | 'recommendation' | 'maintenance';
        location?:       string;
    }): Promise<string> {
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

        const ctxLines = [
            `Item: "${input.itemLabel}"`,
            `Section: "${input.sectionTitle}"`,
            `Tab: ${input.tab}`,
            input.tab === 'defects' && input.category ? `Defect category: ${input.category}` : null,
            input.tab === 'defects' && input.location ? `Location: ${input.location}` : null,
        ].filter(Boolean).join('\n');

        const prompt = `You are a certified home inspector revising a single inspection report comment.
Context:
${ctxLines}

Original comment:
"""${input.originalComment}"""

Instruction from the inspector:
"""${input.instruction}"""

Rewrite the comment to satisfy the instruction while keeping a professional, concise inspection-report tone.
Return only the rewritten comment text — no preamble, no quotes, no markdown.`;

        const text = await this.callGemini(prompt);
        // Strip wrapping quotes / markdown the model sometimes adds.
        return text.replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    /**
     * Suggests 3 professional inspection comments for a specific form item.
     * Throws 503 ServiceUnavailable when GEMINI_API_KEY is not configured so the
     * UI can surface a clear "set up your API key" message instead of a silent
     * empty popover. Runtime Gemini failures still degrade to an empty array.
     */
    async suggestComment(params: {
        itemName:         string;
        sectionName:      string;
        rating?:          string;
        propertyAddress?: string;
        yearBuilt?:       number | null;
        sqft?:            number | null;
    }): Promise<string[]> {
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

        const context = [
            params.rating    ? `Rating: ${params.rating}` : null,
            params.yearBuilt ? `Year Built: ${params.yearBuilt}` : null,
            params.sqft      ? `Sq Ft: ${params.sqft}` : null,
        ].filter(Boolean).join(', ');

        const prompt = `You are a certified home inspector writing a professional inspection report.
Item: "${params.itemName}" in section "${params.sectionName}"${context ? ` (${context})` : ''}.
Write exactly 3 short, professional inspection comments for this item.
Each comment must be 1-2 sentences, factual, and in standard inspection report style.
Return only a JSON array of 3 strings, no other text. Example: ["Comment 1.", "Comment 2.", "Comment 3."]`;

        try {
            const text = await this.callGemini(prompt);
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) return [];
            return JSON.parse(match[0]) as string[];
        } catch {
            return [];
        }
    }
}
