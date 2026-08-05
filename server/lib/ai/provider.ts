/**
 * AiProvider — the single contract every AI backend adapter satisfies.
 *
 * Modelled on `server/lib/email/provider.ts`. The interface is intentionally
 * minimal and, most importantly, carries NO backend-specific concept: no
 * "candidates", no "parts", no model-family naming, no vendor-shaped request
 * envelope. That neutrality is the entire reason the interface exists — the
 * moment one vendor's payload shape leaks into it, adding a second backend
 * means rewriting every caller instead of adding one file under `providers/`.
 *
 * Note what is NOT here: credentials. A provider is constructed with the creds
 * it needs; WHERE those creds came from (the tenant's own key, or a platform
 * key) is a separate decision owned by `resolve-provider.ts`. Managed access is
 * a credential SOURCE, not a second implementation.
 */

/** A single completion request. Sampling knobs are the ones every mainstream
 *  text backend exposes; anything vendor-specific belongs in the adapter. */
export interface AiRequest {
    /** The full prompt text. Prompt construction stays with the caller. */
    prompt: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
}

/** A completion result. Trimmed text only — callers that need structure parse
 *  it themselves, exactly as they did against the raw HTTP response. */
export interface AiResponse {
    text: string;
}

export interface AiProvider {
    /** Stable adapter id for logs and metering tags (e.g. `gemini`). */
    readonly id: string;

    /**
     * Produce a completion. Implementations throw on transport/credential
     * failure — unlike EmailProvider.sendEmail, there is no result-shape
     * error channel here, because every existing AI call site already treats
     * a throw as the failure path and none of them can proceed without text.
     */
    complete(input: AiRequest): Promise<AiResponse>;
}
