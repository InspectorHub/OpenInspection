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
import { isAccessTokenSource, type AiCredential } from '../credential';
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
 * The sentence for a credential the DEPLOYMENT owns and could not obtain.
 *
 * Deliberately not the one above. A short-lived token that could not be
 * refreshed produces the same 401 an invalid key would, but the two are fixed
 * by different people: this one by whoever configured the deployment, and by
 * nobody the workspace can reach. Telling an inspector to check an API key
 * they do not hold sends them somewhere nothing can be changed, which is the
 * worst available answer for a fault that is ours.
 */
export const DEPLOYMENT_CREDENTIAL_MESSAGE =
    'AI is unavailable: this deployment could not obtain credentials for its AI backend. '
    + 'Nothing in workspace settings affects this — it is the deployment\'s own configuration.';

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
    /** An API key that does not expire, or a credential that refreshes itself.
     *  Resolved per CALL, never cached on this instance — see the type. */
    apiKey: AiCredential;
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
        // A credential that refreshes itself KNOWS which backend it belongs to
        // and says so; that beats reading a vendor prefix off a model string,
        // which would make the recorded backend a function of how the model id
        // is spelled. Everything else keeps the derivation it always had.
        this.id = isAccessTokenSource(creds.apiKey)
            ? creds.apiKey.providerId
            : deriveProviderId(creds.baseUrl, creds.model);
    }

    /**
     * The bearer value for one request.
     *
     * A plain key is returned as it stands — the same string, spent the same
     * way, which is the bring-your-own-key path unchanged. A self-refreshing
     * credential is asked EVERY time, because the whole point of it is that
     * the answer changes; remembering one here would rebuild the staleness it
     * exists to remove.
     */
    private async bearer(): Promise<string> {
        const cred = this.creds.apiKey;
        if (!isAccessTokenSource(cred)) return cred;
        try {
            return await cred.getAccessToken();
        } catch {
            // LAYER 2 — the id and the fact, never the cause's text. The
            // thrown error is deliberately NOT bound: a token exchange reports
            // its failure in a body that can quote the credential material it
            // rejected, so there must be no variable here for anyone to log
            // later.
            logger.error('AI deployment credential could not be obtained', {
                provider:  this.id,
                timestamp: new Date().toISOString(),
            });
            // LAYER 1 — an operator's problem, said as one. The reason is the
            // vocabulary's existing "the deployment's platform credential is
            // not usable" member, which every renderer already treats as
            // nothing the workspace can act on.
            throw Errors.AINotConfigured(
                DEPLOYMENT_CREDENTIAL_MESSAGE,
                AI_REFUSAL_REASON.PLATFORM_KEY_MISSING,
            );
        }
    }

    async complete(input: AiRequest): Promise<AiResponse> {
        if (!this.creds.model) {
            throw Errors.AINotConfigured(
                'AI is unavailable: no AI model is configured. Set AI_MODEL for this deployment.',
                AI_REFUSAL_REASON.NOT_CONFIGURED,
            );
        }

        // Before the address, and before anything is serialised: a credential
        // that cannot be obtained must fail without a request being built, so
        // no inspection text is ever assembled for a call that cannot go.
        const token = await this.bearer();

        const url = chatCompletionsUrl(this.creds.baseUrl);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
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
