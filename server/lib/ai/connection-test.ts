/**
 * "Test connection" for the AI settings form — and specifically, a test of the
 * configuration that was just typed.
 *
 * WHAT IT REPLACES, AND WHY THAT MATTERED. The previous diagnostic probed a
 * DEPLOYMENT environment key against one vendor's model-list endpoint. Once the
 * destination became something a workspace chooses, that probe tested nothing
 * any workspace call would use: an unreachable base URL and a model that does
 * not exist would both have shown a green tick, and the workspace would have
 * found out in the middle of an inspection instead. A connection test that
 * tests something other than what was saved is worse than no test at all — it
 * turns "I do not know" into a confident wrong answer.
 *
 * So the address comes from `chatCompletionsUrl`, the SAME helper the adapter
 * uses, and the request is the same shape a real call sends. The two cannot
 * drift apart without the shared helper changing under both.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: diagnose the provider's commercial reason.
 * A status code is a number this codebase did not author. 402 in particular
 * gets no payment language — "your account is unpaid" would be an inference
 * about someone else's business relationship, drawn from a number. All four
 * credential-family statuses get the one sentence the adapter uses.
 */
import { chatCompletionsUrl, PROVIDER_REJECTED_MESSAGE } from './providers/openai-compatible';
import { logger } from '../logger';

/** Which input the workspace should look at. Closed, because the form renders
 *  the message against the matching control and has nowhere to put a fourth.
 *  Not exported: the wire contract is stated once, in
 *  `AiConnectionTestResultSchema`, and a second exported copy would be a second
 *  place for the two to disagree. */
type AiConnectionField = 'baseUrl' | 'model' | 'apiKey';

export type AiConnectionResult =
    | { ok: true }
    | { ok: false; field: AiConnectionField; message: string };

/** Statuses that mean the credentials or the account behind them. Same set the
 *  adapter refuses on, so the button and the real call agree about what is
 *  wrong. */
const CREDENTIAL_STATUSES = new Set([401, 402, 403, 429]);

/**
 * Statuses that mean "the provider does not recognise that model".
 *
 * The one cause statable with confidence, because the id was sent from here. A
 * 400 is included because several providers answer an unknown model id that way
 * rather than with a 404; the cost of being wrong is pointing a workspace at
 * the model field when the real fault was the request shape, which is a far
 * smaller harm than the silence they would otherwise get.
 */
const UNKNOWN_MODEL_STATUSES = new Set([400, 404]);

export interface AiConnectionInput {
    baseUrl: string;
    model: string;
    apiKey: string;
}

export async function testAiConnection(input: AiConnectionInput): Promise<AiConnectionResult> {
    let res: Response;
    try {
        res = await fetch(chatCompletionsUrl(input.baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                model: input.model,
                messages: [{ role: 'user', content: 'ping' }],
                // One token. A diagnostic that generated a full completion
                // would bill the workspace for pressing a button.
                max_tokens: 1,
            }),
        });
    } catch {
        // A throw here is DNS, TLS or a refused connection — never a status.
        // Nothing about the key or the model has been tested yet, so neither
        // is blamed. The thrown error is not surfaced: it can carry the URL,
        // and beyond "could not reach" it says nothing a workspace can act on.
        return { ok: false, field: 'baseUrl', message: 'Could not reach that address.' };
    }

    if (res.ok) return { ok: true };

    if (UNKNOWN_MODEL_STATUSES.has(res.status)) {
        return { ok: false, field: 'model', message: 'The provider does not recognise that model id.' };
    }

    if (CREDENTIAL_STATUSES.has(res.status)) {
        return { ok: false, field: 'apiKey', message: PROVIDER_REJECTED_MESSAGE };
    }

    // Anything else is the endpoint's problem as far as a workspace can act on
    // it. The status goes to the log, not into the sentence they read — and the
    // response BODY goes nowhere at all, because an error body can echo the
    // request and the request is inspection text.
    logger.error('AI connection test failed', {
        status: res.status,
        timestamp: new Date().toISOString(),
    });
    return { ok: false, field: 'baseUrl', message: 'That endpoint did not accept the request.' };
}
