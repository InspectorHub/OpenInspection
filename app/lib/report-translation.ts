/**
 * Applying a stored courtesy translation to a report payload, by path.
 *
 * The server sends two aligned arrays — the translated `segments` and the
 * `paths` they belong to — and this puts one into the other. It never DECIDES
 * anything: which spans were eligible was settled server-side by the segmenter,
 * and re-deriving that here would be a second implementation of the rule, which
 * would drift from the first the day either changed.
 *
 * ## What this cannot do, by construction
 *
 * It writes only at paths the server sent. A path the server did not send is
 * not translated, whatever it contains — so the reliance block, the per-section
 * disclaimers, the limitations tabs and the signature block stay English
 * because no segment was ever produced for them, not because this function
 * recognises them.
 *
 * ## The result is MIXED-LANGUAGE by construction, and that is the design
 *
 * Every span the segmenter refused renders in English inside the translated
 * half. A reader who sees an English paragraph in the middle of Spanish prose
 * and concludes the translation is broken will discount the notice too, so the
 * surfaces that show those spans mark them deliberately — see
 * `<EnglishSpanBadge>`.
 */

/** A deep-enough clone for the JSON payload a report loader carries. */
function clonePayload<T>(value: T): T {
    return structuredClone(value);
}

/**
 * Write `value` at a dotted `path` inside `target`, if the path resolves.
 *
 * Silently does nothing when it does not. That is deliberate: a path that no
 * longer resolves means the payload shape moved under a stored translation, and
 * the honest outcome is that span staying English — not a thrown error on a
 * client's report page, and not a value written somewhere adjacent.
 */
function writeAtPath(target: unknown, path: string, value: string): boolean {
    const parts = path.split('.');
    const last = parts.pop();
    if (last === undefined) return false;

    let node: unknown = target;
    for (const part of parts) {
        if (node === null || typeof node !== 'object') return false;
        node = (node as Record<string, unknown>)[part];
    }
    if (node === null || typeof node !== 'object') return false;
    const holder = node as Record<string, unknown>;
    // Only ever REPLACE a string. Creating a key the payload did not have would
    // put translated prose somewhere no renderer reads and no test would see.
    if (typeof holder[last] !== 'string') return false;
    holder[last] = value;
    return true;
}

/**
 * What the server sends alongside an English report, or null.
 *
 * Declared here rather than on the loader-result type because the translation
 * concern owns it: the notice shape, the path/segment pairing and the writer
 * below are one idea, and the report's loader contract only has to carry it.
 */
export interface CourtesyTranslationPayload {
    locale: string;
    segments: string[];
    paths: string[];
    notice: {
        locale: string;
        title: string;
        text: string;
        /** True when the notice wording IS the record in `notice.locale`. */
        authoritative: boolean;
        version: number;
    };
    generatedAt: number;
}

export interface CourtesyTranslationInput {
    paths: readonly string[];
    segments: readonly string[];
}

export interface AppliedTranslation<T> {
    payload: T;
    /** How many spans were written. */
    applied: number;
    /** How many the payload could not place. Zero in every healthy case. */
    skipped: number;
}

/**
 * Return a copy of `payload` with the translated segments written in.
 *
 * Refuses outright — returning the payload untouched — when the two arrays do
 * not line up. Segments are POSITIONAL, so a mismatched pair maps translated
 * prose onto the wrong components, and the result reads like a correct report
 * describing the wrong house. The server refuses the same case at the seam;
 * this is the second answer, on the side that would actually render it.
 */
export function applyCourtesyTranslation<T>(
    payload: T,
    translation: CourtesyTranslationInput | null | undefined,
): AppliedTranslation<T> {
    if (!translation || translation.paths.length !== translation.segments.length) {
        return { payload, applied: 0, skipped: 0 };
    }
    const next = clonePayload(payload);
    let applied = 0;
    let skipped = 0;
    translation.paths.forEach((path, i) => {
        const value = translation.segments[i];
        if (typeof value !== 'string') { skipped++; return; }
        if (writeAtPath(next, path, value)) applied++;
        else skipped++;
    });
    return { payload: next, applied, skipped };
}
