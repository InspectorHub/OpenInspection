/**
 * #23 — the segmenter. The ONE place a span of a report becomes eligible to
 * reach a model.
 *
 *     getReportData(...)  ->  segmentReport(...)  ->  translateSegments(...)
 *        report payload         ordered spans          the chokepoint
 *                                    ^
 *                     the only place a span becomes eligible
 *
 * Three properties, each of which is a test in
 * `tests/unit/translation/segment-report.spec.ts`:
 *
 *  1. **It enumerates permitted spans; it never filters forbidden ones.** This
 *     function walks the REGISTER, not the payload. The payload is the source
 *     of values; the register is the source of permission. A field added to the
 *     payload tomorrow is invisible here until someone classifies it, which is
 *     the opposite of what a deny-list does.
 *  2. **It is total over the payload.** Every top-level key is classified with
 *     a reason. An unregistered key fails the totality test; it does not
 *     default in either direction.
 *  3. **It is the only caller of the translate path.** Anything reaching the
 *     chokepoint without coming through here can widen the input, and no gate
 *     downstream would notice — the response invariant checks segment COUNT,
 *     which a widened list satisfies exactly.
 *
 * ⚠️ A permitted key with no extractor THROWS rather than emitting nothing. An
 * empty result and a correct result are the same value, and "the classification
 * says yes but nothing reads it" must not be able to hide inside that.
 */
import {
    REPORT_SPAN_REGISTER,
    PERMITTED_LEAF_FIELDS,
    type ReportData,
} from './report-span-register';

export interface ReportSpan {
    /**
     * Stable path into the report payload, e.g. `sections.3.items.2.notes`.
     * A translation is re-inserted positionally against this, so the sequence
     * must be deterministic for a given payload.
     */
    path: string;
    /** The English text. */
    text: string;
    /**
     * Where it came from, for prompt context only. Carries no identity — no
     * address, no client, no inspector, nothing that names a person or a place.
     */
    context?: string;
}

type Emit = (path: string, text: unknown, context?: string) => void;
type Extractor = (value: unknown, emit: Emit) => void;

/** A JSON object, as far as this module needs to know. */
type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Bag) : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Emit the enumerated leaf fields of one object. Nothing else is read. */
function emitLeaves(
    obj: unknown,
    fields: readonly string[],
    path: string,
    context: string,
    emit: Emit,
): void {
    const o = bag(obj);
    if (!o) return;
    for (const field of fields) emit(`${path}.${field}`, o[field], context);
}

/** Photos, wherever they hang. Captions only. */
function emitPhotos(photos: unknown, path: string, context: string, emit: Emit): void {
    list(photos).forEach((p, i) => {
        emitLeaves(p, PERMITTED_LEAF_FIELDS.photo, `${path}.${i}`, context, emit);
    });
}

/** One resolved information or defect entry. */
function emitComments(entries: unknown, path: string, context: string, emit: Emit): void {
    list(entries).forEach((entry, i) => {
        emitLeaves(entry, PERMITTED_LEAF_FIELDS.comment, `${path}.${i}`, context, emit);
        emitPhotos(bag(entry)?.defectPhotos, `${path}.${i}.defectPhotos`, context, emit);
    });
}

/**
 * The extractors, one per permitted key. Held here rather than on the register
 * so the register stays plain data a test can read; the spec asserts the two
 * agree in both directions.
 */
const EXTRACTORS: Record<string, Extractor> = {
    sections(value, emit) {
        list(value).forEach((section, si) => {
            const s = bag(section);
            if (!s) return;
            const sPath = `sections.${si}`;
            // NOTE: `disclaimerText` is deliberately not read. It is a named
            // subject of the non-translatable registry sitting inside a
            // permitted key — the case a key-level answer cannot see.
            emitLeaves(s, PERMITTED_LEAF_FIELDS.section, sPath, 'section heading', emit);

            list(s.items).forEach((item, ii) => {
                const it = bag(item);
                if (!it) return;
                const iPath = `${sPath}.items.${ii}`;
                emitLeaves(it, PERMITTED_LEAF_FIELDS.item, iPath, 'inspection finding', emit);
                emitPhotos(it.photos, `${iPath}.photos`, 'photo caption', emit);

                const tabs = bag(it.resolvedTabs);
                if (tabs) {
                    // `limitations` is NOT read — see PERMITTED_LEAF_FIELDS.
                    emitComments(tabs.information, `${iPath}.resolvedTabs.information`, 'observation', emit);
                    emitComments(tabs.defects, `${iPath}.resolvedTabs.defects`, 'defect description', emit);
                }

                list(it.repairItems).forEach((r, ri) => {
                    emitLeaves(
                        r, PERMITTED_LEAF_FIELDS.repairItem,
                        `${iPath}.repairItems.${ri}`, 'repair item', emit,
                    );
                });

                const original = bag(it.original);
                if (original) {
                    emitLeaves(
                        original, PERMITTED_LEAF_FIELDS.original,
                        `${iPath}.original`, 'baseline finding', emit,
                    );
                    emitPhotos(original.photos, `${iPath}.original.photos`, 'photo caption', emit);
                }
            });
        });
    },

    outline(value, emit) {
        list(value).forEach((entry, i) => {
            emitLeaves(entry, PERMITTED_LEAF_FIELDS.outline, `outline.${i}`, 'contents entry', emit);
        });
    },

    photoAppendix(value, emit) {
        list(value).forEach((entry, i) => {
            emitLeaves(
                entry, PERMITTED_LEAF_FIELDS.appendix,
                `photoAppendix.${i}`, 'photo caption', emit,
            );
        });
    },
};

/**
 * Turn a report payload into the ordered list of spans that MAY be translated.
 *
 * Order is the register's declaration order, then array index throughout, so
 * two calls on one payload produce an identical path sequence.
 */
export function segmentReport(data: ReportData): ReportSpan[] {
    const spans: ReportSpan[] = [];
    const emit: Emit = (path, text, context) => {
        if (typeof text !== 'string') return;
        if (text.trim().length === 0) return;
        spans.push(context === undefined ? { path, text } : { path, text, context });
    };

    const payload = data as unknown as Bag;
    for (const entry of REPORT_SPAN_REGISTER) {
        if (entry.disposition !== 'convenience_translation') continue;
        const extract = EXTRACTORS[entry.key];
        if (!extract) {
            throw new Error(
                `segmentReport: '${entry.key}' is classified convenience_translation but has ` +
                'no extractor. Emitting nothing would be indistinguishable from a report with ' +
                'nothing to translate, so this refuses instead.',
            );
        }
        extract(payload[entry.key], emit);
    }
    return spans;
}
