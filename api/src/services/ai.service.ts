import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { Errors } from '../lib/errors';

/**
 * Service to handle AI-powered features using Google Gemini.
 *
 * Sprint 1 A-4: when running in `standalone` mode without a Gemini API key,
 * `suggestComment` returns dev-mock suggestions so local development can
 * exercise the UI flow end-to-end. Production deploys (`saas` mode or
 * unspecified) throw `Errors.AINotConfigured` (503) so the client can
 * route the inspector to AI settings instead of showing a silent failure.
 */
export class AIService {
    constructor(
        private db: D1Database,
        private apiKey: string,
        private appMode?: 'standalone' | 'saas',
    ) {}

    private isDevMode(): boolean {
        return this.appMode === 'standalone';
    }

    private hasApiKey(): boolean {
        return Boolean(this.apiKey) && !this.apiKey.includes('your_api_key');
    }

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Internal helper to call Gemini API.
     */
    private async callGemini(prompt: string) {
        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            throw new Error('Gemini API Key missing');
        }

        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!res.ok) {
            const error = await res.text();
            logger.error('Gemini API Error', { response: error });
            throw new Error('Failed to generate content from AI');
        }

        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        return data.candidates[0].content.parts[0].text.trim();
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
