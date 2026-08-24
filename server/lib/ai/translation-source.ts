/**
 * "Who translated this", as one string.
 *
 * `report_translations.source` is the only place the identity of the BACKEND is
 * allowed to appear, and it is the first question asked when somebody disputes
 * a word — so the answer has to survive a settings change made afterwards,
 * which is why it is stored on the row rather than re-derived at read time.
 *
 * The shape is `<provider id>:<credential source>`, e.g.
 * `openai-compatible:byo`. Two facts, not one: which adapter produced the text,
 * and on whose credentials it ran. Neither answers the other — the same adapter
 * serves a workspace's own key and a deployment-provided one.
 *
 * ⚠️ This string must never reach a PDF cache key or a freshness comparison. A
 * translation is produced once and stored; the backend that produced it changes
 * no rendered byte, so putting it in a render basis would invalidate every
 * published document on a settings flip and re-render each one to byte-identical
 * output. See `services/inspection/report-grain.ts`.
 *
 * Its own module rather than a line inside the chokepoint, because
 * `services/ai.service.ts` has three lines of headroom against the large-file
 * limit and is not in the baseline — growing past it there is a NEW violation
 * rather than a ratchet bump.
 */
import type { AiCredentialSource } from './resolve-provider';

/**
 * @param providerId `AiProvider.id`, or undefined when no adapter resolved.
 * @param source     Whose credentials the call ran on.
 */
export function translationSourceTag(
    providerId: string | undefined,
    source: AiCredentialSource,
): string {
    // `unresolved` rather than an empty half: a row reading `:byo` looks like a
    // truncation and invites a reader to guess which adapter it was. There is
    // no adapter behind a refusal, and the row should say so — although in
    // practice a refusal never reaches storage, because the call throws first.
    return `${providerId ?? 'unresolved'}:${source}`;
}
