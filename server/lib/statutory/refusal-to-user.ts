/**
 * Getting this subsystem's refusals to the person holding the form.
 *
 * -- WHAT WENT WRONG ---------------------------------------------------------
 * Every refusal in `produce.service.ts`, `render.ts`, `fit.ts`, `values.ts` and
 * `value-parts.ts` is a sentence written to be READ: which field, what arrived,
 * and what to do about it. They are thrown as plain `Error`s, and the route did
 * not catch them, so the browser received:
 *
 *     {"error":{"message":"Internal server error"}}
 *
 * Measured 2026-08-30 on the FL Citizens roof pack, where the sentence that got
 * swallowed was `2 required field(s) were never supplied: inspector_signature,
 * inspector_signature_date` — the exact two facts an inspector standing in a
 * house with the fieldwork already done needs in order to finish.
 *
 * The route's OWN refusals (a withdrawn revision, a superseded template) always
 * reached the reader, because those are `AppError`s. That asymmetry is what made
 * the gap easy to miss: the feature looked like it explained itself.
 *
 * -- WHY 422 AND NOT 500 -----------------------------------------------------
 * The request is well formed and the caller is entitled to it; the INSPECTION is
 * not yet in a state that can produce this document. That is the definition of
 * 422, and it is also what tells a client this is worth showing rather than
 * retrying.
 *
 * -- WHY THE PREFIX IS STRIPPED ----------------------------------------------
 * `statutory render:` names which stage refused, which matters in a log and is
 * noise to a reader. It is logged and dropped, so one sentence serves both.
 */
import { AppError, Errors } from '../errors';
import { logger } from '../logger';

/**
 * The prefixes this subsystem throws with. A message that carries none of them
 * is NOT translated — it is an unexpected failure, and dressing it up as a
 * refusal the reader can act on would be a lie with a status code on it.
 */
const REFUSAL_PREFIXES = [
    'statutory produce: ',
    'statutory render: ',
    'statutory inspection date: ',
] as const;

function refusalSentence(message: string): string | null {
    for (const prefix of REFUSAL_PREFIXES) {
        if (message.startsWith(prefix)) return message.slice(prefix.length);
    }
    return null;
}

/**
 * Run one step of the produce path, turning its refusal into an answer.
 *
 * @param step the call to make. Passed as a thunk rather than awaited by the
 *   caller so the `try` is impossible to leave off at a call site.
 */
export async function refusalToUser<T>(step: () => Promise<T>): Promise<T> {
    try {
        return await step();
    } catch (cause) {
        // An AppError already decided its own status and sentence — the route's
        // own refusals come through here and must pass unchanged.
        if (cause instanceof AppError) throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        const sentence = refusalSentence(message);
        if (sentence === null) throw cause;
        logger.warn('statutory: production refused', { reason: message });
        throw Errors.UnprocessableEntity(
            `This statutory form cannot be produced yet. ${sentence}`,
        );
    }
}
