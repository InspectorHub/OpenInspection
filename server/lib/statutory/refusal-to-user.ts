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
 *
 * -- THREE MORE, FOUND BY PRODUCING A FORM THAT USES THEM -------------------
 * Measured 2026-08-30 on FL OIR-B1-1802: answering a question that form does
 * not ask returned `{"error":{"message":"Internal server error"}}` — the exact
 * swallow described above, one prefix over. `collectStatutoryValues` calls
 * `resolve-source` (`statutory values:`), `groups.ts` (`statutory group:`) and
 * `overflow.service.ts` (`statutory overflow:`), and none of the three was
 * listed. All three write the same kind of sentence for the same reader: which
 * field, what arrived, what to do about it.
 *
 * -- TWO PREFIXES ARE DELIBERATELY ABSENT, AND THE LINE IS "WHOSE FAULT" -----
 * `statutory binding policy:` is thrown while a template is INSTALLED, never
 * while a form is produced.
 *
 * `statutory field map:` IS on this path — `render.ts` calls
 * `validateFieldMapShape` — and is still not translated, because it is the one
 * refusal here that says nothing about this inspection. A published map with
 * overlapping targets or a partial date family is broken for every inspection
 * equally; no answer an inspector could give would change it, and a 422 would
 * tell them their document is not ready when the truth is that this software
 * shipped a bad map. That belongs in the logs as the failure it is.
 *
 * ⚠️ A new prefix in this subsystem belongs here the day it is written, unless
 * it fails the same test. What a wrongly missing one looks like is a 500 on a
 * request that was refused for a reason somebody could have acted on — and
 * nothing goes red.
 */
const REFUSAL_PREFIXES = [
    'statutory produce: ',
    'statutory render: ',
    'statutory inspection date: ',
    'statutory values: ',
    'statutory group: ',
    'statutory overflow: ',
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
            // Sentence-cased at the join. The refusals downstream are written as
            // continuations and several start lowercase, so concatenating them
            // raw produced "…cannot be produced yet. the \"…\" form has not been
            // supplied" — seen in a browser on 2026-09-05. Nothing here can be
            // asserted about the original casing without changing every message
            // that already reads correctly, so only the FIRST character moves.
            `This statutory form cannot be produced yet. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`,
        );
    }
}
