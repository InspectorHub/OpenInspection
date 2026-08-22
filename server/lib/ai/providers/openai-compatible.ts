/**
 * The ONE adapter. Every deployment runs it; they differ only in base URL and
 * model string.
 *
 *   managed      an AI gateway `/compat` endpoint  ·  model `{vendor}/{model}`
 *   own key      the workspace's own provider      ·  the workspace's model
 *   self-hosted  anything, including a LAN address
 *
 * There is no second adapter because there is nothing left for one to do: the
 * OpenAI-compatible endpoints the mainstream vendors publish all take the same
 * `Authorization: Bearer` header, the same `messages[]` body and the same
 * `choices[]` response — as do a local Ollama or vLLM. Vendor-native shapes
 * (`x-goog-api-key`, `contents[].parts[]`, `candidates[0].content.parts[0]`)
 * have no place here.
 *
 * WHAT IS NOT HERE: credentials resolution. A provider is constructed with what
 * it needs; where that came from is `resolve-provider.ts`'s decision.
 *
 * WHAT IS ALSO NOT HERE: `topK`. `AiRequest` carries it because some backends
 * expose it natively, but the OpenAI chat-completions schema has no such field.
 * Sending it is ignored at best and a 400 at worst, so it is dropped rather
 * than translated into a guess at the nearest equivalent.
 */
import { Errors } from '../../errors';
import { AI_REFUSAL_REASON } from '../refusal-reason';
import { logger } from '../../logger';
import type { AiProvider, AiRequest, AiResponse } from '../provider';

/** Status codes that mean "your credentials or your account", not "try again".
 *  These must reach the caller as a REFUSAL: on a workspace's own key it is
 *  their own provider account, only they can fix it, and a degrade would hide
 *  that from the one person who could act. */
const CREDENTIAL_STATUSES = new Set([401, 402, 403, 429]);

/**
 * The ONE sentence every credential refusal shows.
 *
 * It is deliberately the same for 401, 402, 403 and 429. Splitting it per
 * status would mean telling a customer WHY a third party refused them, and the
 * only thing actually known here is a number this codebase did not author. 402
 * especially: "your account is unpaid" is an inference about someone else's
 * commercial relationship. The status reaches the log, not the inspector.
 */
export const PROVIDER_REJECTED_MESSAGE =
    'The AI provider rejected this request. Check your API key, account status, '
    + 'service tier, or billing configuration with your provider.';

/**
 * The one place a base URL becomes a request address.
 *
 * Exported because the settings connection test posts to it too. That is the
 * point: a diagnostic that derived the address separately could go green
 * against an endpoint no real call ever visits, and the workspace would learn
 * the truth mid-inspection instead of at the Test button.
 */
export function chatCompletionsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export interface OpenAiCompatibleCredentials {
    apiKey: string;
    model: string;
    /** Root of an OpenAI-compatible API, with or without a trailing slash. */
    baseUrl: string;
    /** Workspace and user tags for gateway logs. Meaningful only on the
     *  managed path — a gateway header sent to somebody else's API is noise,
     *  and one carrying workspace ids is worse than noise, so it is emitted
     *  only when the base URL really is the gateway. Five entries maximum. */
    gatewayMetadata?: Record<string, string>;
}

export class OpenAiCompatibleProvider implements AiProvider {
    readonly id: string;

    constructor(private readonly creds: OpenAiCompatibleCredentials) {
        this.id = deriveProviderId(creds.baseUrl, creds.model);
    }

    async complete(input: AiRequest): Promise<AiResponse> {
        if (!this.creds.model) {
            throw Errors.AINotConfigured(
                'AI is unavailable: no AI model is configured. Set AI_MODEL for this deployment.',
                AI_REFUSAL_REASON.NOT_CONFIGURED,
            );
        }

        const url = chatCompletionsUrl(this.creds.baseUrl);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.creds.apiKey}`,
        };
        if (isCloudflareGateway(this.creds.baseUrl)) {
            // NOT a dashboard setting. AI Gateway stores request and response
            // bodies by default, and these carry client names and addresses.
            // Set per request because a dashboard toggle can be turned back on
            // by anyone and nothing would report it. Metadata, token counts,
            // cost and duration all survive this; the payload does not.
            headers['cf-aig-collect-log-payload'] = 'false';
            if (this.creds.gatewayMetadata) {
                headers['cf-aig-metadata'] = JSON.stringify(this.creds.gatewayMetadata);
            }
        }
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.creds.model,
                messages: [{ role: 'user', content: input.prompt }],
                temperature: input.temperature ?? 0.2,
                top_p: input.topP ?? 0.8,
                max_tokens: input.maxOutputTokens ?? 1024,
            }),
        });

        if (!res.ok) {
            // LAYER 2 — for support, never for the inspector. Status and ids
            // only: the body of a 4xx can echo the request, and the request is
            // inspection text carrying names and addresses.
            logger.error('AI provider call failed', {
                provider:  this.id,
                status:    res.status,
                requestId: res.headers.get('x-request-id') ?? res.headers.get('cf-ray') ?? null,
                timestamp: new Date().toISOString(),
            });
            if (CREDENTIAL_STATUSES.has(res.status)) {
                // LAYER 1 — one sentence for all four statuses. What is known
                // is an HTTP status, NOT the provider's commercial reason, so
                // 402 gets no payment language.
                throw Errors.AINotConfigured(
                    PROVIDER_REJECTED_MESSAGE,
                    AI_REFUSAL_REASON.UPSTREAM_CREDENTIAL,
                );
            }
            // A plain Error, so the caller's runtime-failure degrade applies.
            throw new Error('Failed to generate content from AI');
        }

        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new Error('AI provider returned no completion');
        return { text: text.trim() };
    }
}

/**
 * Whether this base URL really is Cloudflare's AI Gateway.
 *
 * Matched on the parsed HOSTNAME, anchored at both ends. A substring test over
 * the whole URL would accept `notgateway.ai.cloudflare.com.example.invalid`,
 * and the answer decides whether a header carrying workspace identifiers is
 * sent to that host.
 */
function isCloudflareGateway(baseUrl: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(baseUrl).hostname;
    } catch {
        return false;
    }
    return /(^|\.)gateway\.ai\.cloudflare\.com$/.test(hostname);
}

/**
 * The id the provenance ledger records, derived from the instance about to be
 * called — never from configuration, per the rule stated in `provenance.ts`.
 *
 * Through a unified gateway endpoint every vendor shares one host, so the host
 * alone would record the gateway for all of them and the ledger would stop
 * answering the question it exists for. The vendor is in the model prefix there
 * (`{vendor}/{model}`), so that wins when present.
 */
function deriveProviderId(baseUrl: string, model: string): string {
    const slash = model.indexOf('/');
    if (slash > 0) return model.slice(0, slash);
    try {
        return new URL(baseUrl).hostname;
    } catch {
        // A base URL that will not parse is a configuration error the call
        // itself will surface. Naming it here rather than throwing keeps a
        // construction-time helper from turning into a second failure path.
        return 'unknown';
    }
}
