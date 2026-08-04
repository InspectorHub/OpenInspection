import type { AiProvider, AiRequest, AiResponse } from '../provider';
import { logger } from '../../logger';
import { Errors } from '../../errors';

/**
 * Google Gemini adapter — the only place in the codebase that knows Gemini's
 * URL shape, request envelope, or `candidates[].content.parts[].text` response.
 *
 * Credentials arrive already resolved (see `resolve-provider.ts`); this class
 * is identical whether the key is the tenant's own or the platform's.
 */
export interface GeminiCreds {
    apiKey: string;
    /** Model id from deployment configuration. Empty = not configured, which
     *  fails closed — there is deliberately no default model in the source. */
    model: string;
}

export class GeminiProvider implements AiProvider {
    readonly id = 'gemini';

    constructor(private creds: GeminiCreds) {}

    async complete(input: AiRequest): Promise<AiResponse> {
        if (!this.creds.apiKey || this.creds.apiKey.includes('your_api_key')) {
            throw new Error('Gemini API Key missing');
        }
        if (!this.creds.model) {
            throw Errors.AINotConfigured(
                'AI is unavailable: no AI model is configured. Set AI_MODEL for this deployment.',
            );
        }

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(this.creds.model)}:generateContent?key=${this.creds.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: input.prompt }] }],
                    generationConfig: {
                        temperature:     input.temperature     ?? 0.2,
                        topP:            input.topP            ?? 0.8,
                        topK:            input.topK            ?? 40,
                        maxOutputTokens: input.maxOutputTokens ?? 1024,
                    },
                }),
            },
        );

        if (!res.ok) {
            const error = await res.text();
            logger.error('Gemini API Error', { response: error });
            throw new Error('Failed to generate content from AI');
        }

        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        return { text: data.candidates[0].content.parts[0].text.trim() };
    }
}
