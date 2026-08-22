/**
 * Reading a model's answer back as an ORDERED list of translated segments.
 *
 * WHY THIS IS ITS OWN MODULE. The rule it enforces is not about AI. Callers
 * re-insert these strings POSITIONALLY into the English report structure, so a
 * response of a different length is not a partial success to salvage: mapping
 * it attaches translated prose to the wrong components, and the result reads
 * like a correct report while describing the wrong house. That failure has no
 * later detector — no gate, no test of the rendered document and no reader
 * who does not speak both languages would catch it — so it has to be refused
 * at the only moment the two lengths are both in hand. The translation is
 * WITHHELD; a report with an English half and no translated half is a state
 * this feature already handles.
 *
 * It also keeps `services/ai.service.ts` under the large-file ratchet, which is
 * why the extraction happened when it did rather than later.
 */
import { Errors } from '../errors';

/** Everything unreadable arrives as the same refusal. The distinction a caller
 *  needs is "no usable translation", not which of four shapes came back — and a
 *  message that named the shape would be describing the model's mood. */
const UNREADABLE =
    'The translation service returned a response that could not be read as a list of segments.';

/**
 * @param text     The raw completion.
 * @param expected How many segments were sent. The response must match exactly.
 * @throws 503 when the response cannot be read, or reads but has the wrong length.
 */
export function parseTranslatedSegments(text: string, expected: number): string[] {
    // Models wrap the array in prose or a code fence often enough that finding
    // the array is part of reading the answer, not a workaround. The greedy
    // match takes the outermost brackets, which is right for a nested array and
    // wrong only for two separate arrays — a shape the length check then
    // refuses anyway.
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw Errors.ServiceUnavailable(UNREADABLE);

    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        // Malformed JSON between real brackets — a trailing comma, an unescaped
        // quote inside a translated sentence. Caught rather than allowed to
        // surface as a raw SyntaxError, which would reach the caller as a 500
        // and read as a bug in this product rather than an unusable answer.
        throw Errors.ServiceUnavailable(UNREADABLE);
    }

    if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== 'string')) {
        // The member check is not pedantry: `Array.isArray` alone would hand a
        // caller `[null]` and let the null reach a rendered report.
        throw Errors.ServiceUnavailable(UNREADABLE);
    }

    if (parsed.length !== expected) {
        // Both numbers, on purpose. "Translation failed" with no figures is
        // indistinguishable from an outage when it is read back later, and this
        // is the one failure the module exists for.
        throw Errors.ServiceUnavailable(
            `The translation service returned ${parsed.length} segment(s) for ${expected} sent. `
            + 'A courtesy translation is withheld rather than mapped to the wrong content.',
        );
    }

    return parsed as string[];
}
