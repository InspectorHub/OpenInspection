/**
 * What a call is missing, and what each audience is told about it.
 *
 * The model and endpoint a call runs on are those of the provider
 * `resolve-provider.ts` selected, so "is it configured" is a question about that
 * provider, asked of that provider. It used to be asked of the deployment's
 * environment instead, which refused a company that had saved its own key,
 * endpoint and model while the Test button, which checks the saved values,
 * passed.
 *
 * Two audiences read a refusal, and they fix different things:
 *   - a company on its OWN key can fix a missing field in Settings, so the
 *     message names the field in plain words;
 *   - a company on the provided path can fix nothing, so it is told only that
 *     AI is unavailable.
 * Neither message names a deployment setting. The operator's hint, with the
 * setting name, goes to the log, where an operator reads.
 *
 * The machine code is unchanged for every case here: 503 `AI_NOT_CONFIGURED`
 * with the `not_configured` reason, the one shape clients already route.
 */
import { Errors } from '../errors';
import { logger } from '../logger';
import { AI_REFUSAL_REASON } from './refusal-reason';
import type { AiProvider } from './provider';
import type { AiCredentialSource } from './resolve-provider';

const SETTINGS_PATH = 'Settings → Advanced → AI';

/** The one sentence for a gap the company cannot close. */
const AI_UNAVAILABLE_MESSAGE = 'AI is not available right now.';

/** Thrown by the adapter when the endpoint answers 400 or 404, which is how
 *  providers say they do not know the model id. Typed so the service, which
 *  knows whose model it was, decides what the company is told. */
export class AiUnknownModelError extends Error {
    constructor(readonly model: string) {
        super('The AI endpoint did not recognise the model.');
        this.name = 'AiUnknownModelError';
    }
}

function refuse(message: string) {
    return Errors.AINotConfigured(message, AI_REFUSAL_REASON.NOT_CONFIGURED);
}

/** Throws unless the provider has both a model and an endpoint to send to. */
export function assertProviderConfigured(provider: AiProvider, source: AiCredentialSource): void {
    const missing = !provider.model ? 'model' : !provider.endpoint ? 'endpoint' : null;
    if (!missing) return;
    logger.warn('AI call refused: the selected provider has no ' + missing, {
        source,
        missing,
        hint: missing === 'model'
            ? `Set AI_MODEL for this deployment, or save a model in ${SETTINGS_PATH}.`
            : `Set AI_BASE_URL for this deployment, or save an endpoint in ${SETTINGS_PATH}.`,
    });
    if (source !== 'byo') throw refuse(AI_UNAVAILABLE_MESSAGE);
    throw refuse(missing === 'model'
        ? `Your AI account needs a model name. Add one in ${SETTINGS_PATH}.`
        : `Your AI account needs an endpoint address. Add one in ${SETTINGS_PATH}.`);
}

/** The refusal for a model id the endpoint did not recognise. */
export function unknownModelRefusal(model: string, source: AiCredentialSource) {
    logger.warn('AI endpoint did not recognise the model', { source, model });
    if (source !== 'byo') return refuse(AI_UNAVAILABLE_MESSAGE);
    return refuse(`The AI service did not recognise the model name ${model}. Check it in ${SETTINGS_PATH}.`);
}
